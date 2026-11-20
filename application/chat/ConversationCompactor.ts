/**
 * 会话上下文压缩（compact）与检查点（checkpoint）
 * @module application/chat/ConversationCompactor
 *
 * 需求（2026-11-19 定稿）：单会话上下文过长时自动 compact，避免 LLM 上下文超限；
 * 每次 compact 产生一个 checkpoint；旧信息不要无声消失。暂不做跨会话、向量检索、
 * 记忆外置、模型自主决定 compact。
 *
 * 触发判据是**可观测事实**：`planConversationWindow()` 本来就要算出哪些消息被
 * 窗口（条数 / 单条字符 / 总预算）丢掉；只要出现被丢的旧消息，就把它们送去摘要，
 * 而不是再引入一个「快满了」的比例阈值。零新常量、零估算：只消费既有
 * `CONTEXT_LIMITS`（见 ConversationPrompt.ts 里各数值的出处）。
 *
 * 语义边界：
 * - complete history 不删：`ChatHistoryManager` / `FavoriteService` 里的完整消息、
 *   附件本体、标题、角色均不动；compact 只改「模型本轮所见上下文」。
 * - compact 是宿主内部行为：不挂模型工具、不进 `kv_*` 工具集、不进过程块、
 *   不写会话历史；摘要请求是旁路纯文本调用，复用 `generateSessionTitle()` 的范式。
 * - checkpoint 每次**追加**（不覆盖），链留在 `checkpoints` 域（host-only 写）；
 *   当前会话只持「最新 seq」指针，配合既有 `kv_slice` 可分页查看。
 * - 失败静默降级：摘要失败 / 存储不可用 → 退回现有窗口裁剪，对话照常，不抛错、
 *   不提示、不重试。
 * - 摘要输入不带图片 / PDF base64：只带 `describeAttachment()` 的文字描述；
 *   旧附件本体仍留在完整历史里。
 *
 * 数值铁律：本文件不改写 `maxMessages / maxCharsPerMessage / maxTotalChars`，
 * 不引入新 magic number。摘要输出按 `CONTEXT_LIMITS.maxCharsPerMessage` 硬截断
 * 兜底（这是宿主已有的单条文本上限，不是新阈值）；溢出重试封顶 1 次。
 */

import type { IModelGateway } from '../model/IModelGateway';
import type {
  ConversationHistoryMessage, ConversationSummary, WindowedMessage,
} from './ConversationPrompt';
import { CONTEXT_LIMITS, planConversationWindow } from './ConversationPrompt';
import { describeAttachment } from './ChatAttachment';
import { truncateChars } from './SessionTitle';
import { md5 } from 'js-md5';

/** 摘要任务标识：纯文本 chat completions，不挂工具、不入历史 */
export const CHAT_COMPACT_TASK = 'chat.compact' as const;

/** checkpoint 结构版本：读取旧/畸形数据时按不可用处理，不猜字段 */
export const CHECKPOINT_VERSION = 1;

/** checkpoints 域里保存 checkpoint 链 + 最新指针时用的键后缀 */
const CHAIN_KEY_SUFFIX = '.chain';
const POINTER_KEY_SUFFIX = '.pointer';

export type CompactReason = 'window-drop' | 'overflow';

/**
 * 一条检查点。追加写，不覆盖；`firstKeptIndex` 是压缩边界（完整历史里的下标）。
 * 时间戳只用于展示 / 排序，不参与任何判定。
 */
export interface ConversationCheckpoint extends ConversationSummary {
  version: typeof CHECKPOINT_VERSION;
  sessionId: string;
  fromTs: number | null;
  toTs: number | null;
  reason: CompactReason;
  createdAt: number;
}

/** host-only 存储面：由装配方用 `KvService` 的宿主专用接口适配注入 */
export interface CheckpointStore {
  readRaw(domain: string, key: string): Promise<unknown | null>;
  put(domain: string, key: string, value: unknown): Promise<{ ok: boolean; reason?: string }>;
}

/** 溢出识别的可选钩子：P3b 由 wire 层补精确识别后注入；缺省只认显式标记 */
export interface CompactDeps {
  gateway: IModelGateway;
  store?: CheckpointStore;
  /** 测试注入时钟，避免断言写死 Date.now() */
  now?: () => number;
  /** 模型返回是否「上下文溢出」；不传时用宿主保守正则兜底 */
  isOverflowError?: (error: unknown) => boolean;
}

/**
 * re-export：窗口规划的唯一实现在 ConversationPrompt.ts（与上下文构造共用）。
 * 单测与装配方都从本模块拿，避免两套口径漂移。
 */
export { planConversationWindow } from './ConversationPrompt';

/** 会话 id 含冒号（`session:...`），不能直接当 KV key：确定性短 hash，无新常量 */
function safeKeyPart(sessionId: string): string {
  return md5(sessionId).toLowerCase().slice(0, 24);
}

function chainKey(sessionId: string): string {
  return `compact.${safeKeyPart(sessionId)}${CHAIN_KEY_SUFFIX}`;
}
function pointerKey(sessionId: string): string {
  return `compact.${safeKeyPart(sessionId)}${POINTER_KEY_SUFFIX}`;
}

/** 把一条历史消息变成摘要输入文本：附件只留文字描述，不带 base64 */
function renderForSummary(m: ConversationHistoryMessage, index: number): string {
  const attachments = m.attachments && m.attachments.length > 0
    ? `\n[随附资源：${m.attachments.map(describeAttachment).join('；')}；正文不含资源本体]`
    : '';
  return `${index + 1}. ${m.role === 'user' ? '用户' : '助手'}：${m.content}${attachments}`;
}

const COMPACT_SYSTEM_PROMPT = [
  '你在为一段连续对话生成「上下文检查点摘要」，供后续轮次接着聊。',
  '只输出摘要正文，不要解释、不要寒暄、不要代码块、不要复述本指令。',
  '必须保留：已确认的事实、已做出的决定、用户明确表达的偏好、指代对象（他/这个/那次指什么）、',
  '尚未完成的事项、以及 ID / 代码 / 数字 / URL / 文件名等不透明标识符（逐字照抄，不要改写或补全）。',
  '若输入里已有「上一版摘要」，把它与新增的被裁掉的旧消息合并成一份连续摘要（re-distill），',
  '不要丢掉上一版里仍然有效的要点，也不要把同一件事重复写两遍。',
  '被裁掉的消息只是不再逐字发给模型，不代表作废；摘要要让后来的模型能正确理解追问。',
].join('\n');

/** 畸形 / 旧版本 checkpoint 链一律按空链处理，静默降级 */
function readChain(raw: unknown): ConversationCheckpoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is ConversationCheckpoint => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const c = v as Record<string, unknown>;
    return c['version'] === CHECKPOINT_VERSION
      && typeof c['seq'] === 'number'
      && typeof c['summary'] === 'string'
      && typeof c['sessionId'] === 'string'
      && typeof c['firstKeptIndex'] === 'number'
      && (c['reason'] === 'window-drop' || c['reason'] === 'overflow');
  });
}

/** 保守溢出识别：显式标记 / 常见端点文案；不猜栈，不吞其它错误 */
function defaultIsOverflowError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /context[_ -]?length|context[_ -]?window|maximum context|too many tokens|prompt is too long|上下文.*(超限|过长)|token.*(超限|超过)/i.test(text);
}

export class ConversationCompactor {
  constructor(private readonly deps: CompactDeps) {}

  /**
   * 同步 compact：在 runTurn 构造上下文前调用，返回本轮要注入的最新 checkpoint。
   * 无窗口丢弃 / 摘要失败 / 存储失败 → 返回 null，调用方按原窗口继续，对话不受影响。
   */
  async maybeCompact(
    history: ReadonlyArray<ConversationHistoryMessage>,
    sessionId: string,
    reason: CompactReason = 'window-drop',
  ): Promise<ConversationCheckpoint | null> {
    const { kept, dropped } = planConversationWindow(history);
    if (dropped.length === 0) return null;
    const firstKeptIndex = kept.length > 0 ? kept[0]!.historyIndex : history.length;

    try {
      if (!this.deps.gateway.isReady()) return null;
      const previous = await this.loadLatest(sessionId);
      // 增量蒸馏：上一版摘要已经覆盖了 [0, previous.firstKeptIndex)，本轮只喂
      // [previous.firstKeptIndex, firstKeptIndex) 里**新增**被丢的消息。
      // 不把全量历史反复喂给摘要端点：既避免摘要请求随会话线性膨胀，也避开
      // 「整段会话一次喂进去被内容安全拦截」的已知不稳（见本机 TOOLS.md）。
      const newDropped = previous
        ? dropped.filter((m) => m.historyIndex >= previous.firstKeptIndex && m.historyIndex < firstKeptIndex)
        : dropped;
      // 上一版已经覆盖到同一边界：没有新信息可压，直接复用，不追加、不再发一次请求。
      // （若上一版边界比本轮还靠后 —— 只可能发生在会话 id 复用而历史被删短时 ——
      // filter 同样为空，走这条复用分支：不写新数据、不回退 seq，安全降级。）
      if (newDropped.length === 0 && previous) return previous;
      const summary = await this.summarize(newDropped, previous);
      if (!summary) return null;
      const checkpoint: ConversationCheckpoint = {
        version: CHECKPOINT_VERSION,
        seq: (previous?.seq ?? 0) + 1,
        sessionId,
        summary,
        firstKeptIndex,
        fromTs: this.timestampOf(dropped[0]),
        toTs: this.timestampOf(dropped[dropped.length - 1]),
        reason,
        createdAt: (this.deps.now ?? Date.now)(),
      };
      await this.append(sessionId, checkpoint);
      return checkpoint;
    } catch {
      return null; // 失败静默降级：退回窗口裁剪
    }
  }

  /** 读取当前会话最新 checkpoint；链坏 / 存储不可用一律 null */
  async loadLatest(sessionId: string): Promise<ConversationCheckpoint | null> {
    if (!this.deps.store) return null;
    try {
      const raw = await this.deps.store.readRaw('checkpoints', chainKey(sessionId));
      const chain = readChain(raw);
      if (chain.length === 0) return null;
      return chain.reduce((a, b) => (b.seq > a.seq ? b : a));
    } catch {
      return null;
    }
  }

  /** 溢出时由调用方询问；同一 turn 的重试次数由调用方管，本类不自行循环 */
  isOverflowError(error: unknown): boolean {
    return (this.deps.isOverflowError ?? defaultIsOverflowError)(error);
  }

  private timestampOf(m: ConversationHistoryMessage | undefined): number | null {
    if (!m) return null;
    const ts = (m as { timestamp?: unknown })['timestamp'];
    return typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
  }

  private async summarize(
    newDropped: ReadonlyArray<WindowedMessage>,
    previous: ConversationCheckpoint | null,
  ): Promise<string | null> {
    const parts: string[] = [];
    if (previous) parts.push(`【上一版摘要（seq=${previous.seq}）】\n${previous.summary}`);
    parts.push('【本轮新增被窗口裁掉的旧消息（按时间从旧到新）】');
    newDropped.forEach((m) => parts.push(renderForSummary(m, m.historyIndex)));
    try {
      const result = await this.deps.gateway.execute({
        task: CHAT_COMPACT_TASK,
        messages: [
          { role: 'system', content: COMPACT_SYSTEM_PROMPT },
          { role: 'user', content: parts.join('\n\n') },
        ],
        options: { jsonMode: false },
      });
      const text = result.text.trim();
      if (!text) return null;
      // 兜底沿用宿主具名单条上限，不另造摘要长度常量
      return truncateChars(text, CONTEXT_LIMITS.maxCharsPerMessage);
    } catch {
      return null;
    }
  }

  /** 追加 checkpoint（不覆盖）；同时更新「最新 seq」指针，两者失败都静默降级 */
  private async append(sessionId: string, checkpoint: ConversationCheckpoint): Promise<void> {
    const store = this.deps.store;
    if (!store) return;
    const raw = await store.readRaw('checkpoints', chainKey(sessionId));
    const chain = [...readChain(raw), checkpoint];
    const saved = await store.put('checkpoints', chainKey(sessionId), chain);
    if (!saved.ok) return;
    await store.put('checkpoints', pointerKey(sessionId), {
      sessionId, seq: checkpoint.seq, updatedAt: checkpoint.createdAt,
    });
  }
}
