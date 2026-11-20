/**
 * 自由聊天 system prompt 与上下文窗口常量
 * @module application/chat/ConversationPrompt
 *
 * 「闲聊」角色专用，但它现在是标准 tool-calling agent：模型自己判断
 * 要不要取网页 / 读 PDF / 看图片，宿主只提供工具与观察。因此 system prompt
 * 不再禁止结构化输出（模型可能返回 tool_calls），改为说明「需要时才访问网络」。
 *
 * 角色由用户在页面上显式选择（见 ChatRole）；插件开发角色挂的是插件工具集，
 * 由 ToolLoop 用自己的动态 system 替换本段，不在这里提插件，避免闲聊被拽回插件话题。
 */

import type { ModelPart } from '../model/IModelGateway';
import { attachmentsToModelParts, type ChatAttachment } from './ChatAttachment';

export const CONVERSATION_SYSTEM_PROMPT = [
  '你是「围棋 AI 对话」助手，正在与用户进行连续的自然语言对话。',
  '用简洁、自然的中文回答；用户可能在追问、使用「他」「这个」「再具体点」等指代，',
  '请结合前面的对话理解，不要要求用户重复已经说过的内容。',
  '你可以聊围棋知识、棋手、规则、赛事，也可以进行与围棋无关的日常聊天。',
  '用户问什么就答什么：闲聊就自然闲聊，不要主动引出插件、代码或开发话题，',
  '也不要复述自己的身份设定或工作流程；若用户主动问起某项能力，就如实回答。',
  '即使前面的对话里出现过插件相关内容，只要用户当前没提，就按当前话题正常回答。',
  '需要核实资料、读取用户给出的链接或某个具体网页时，可调用 web_fetch 工具取回内容再归纳；',
  'web_fetch 的观察：短响应会直接给出完整正文；长响应只含正文的一小段预览，',
  '其余部分存在宿主缓存里，必须用 web_cache_read（url 填观察里的 URL，mode=slice 分页 / mode=grep 按正则查找）读完再下结论，',
  '唯一例外：观察里写了「storeOnly：正文不进上下文」时，那是宿主的数据旁路——正文已由宿主工具直接展示给用户，你不要调用 web_cache_read 把它读回来，也不要凭句柄下结论；只有用户之后明确要求分析该内容时才按需读缓存。',
  '绝不能只凭预览猜测或编造未显示的内容；缓存只在本次会话有效，刷新页面后需重新 web_fetch。',
  '要读 PDF 时调用 web_read_pdf（默认抽取文字层；扫描件或要看版式时用 mode=native）；',
  '要看图片（棋谱截图、表格、照片里的文字）时调用 web_read_image，图片会作为随附内容送达；',
  '用户直接附加的 PDF / 图片也会随消息送达，无需再调用工具重复读取。',
  '普通闲聊、围棋知识问答不需要访问网络，直接回答即可。',
  '归纳网页 / PDF / 图片内容时请标注来源（URL 或文件名）；无法访问或端点不支持时如实说明，不要编造内容。',
  '此前轮次读过的资源内容会作为附件随历史保留，追问时直接沿用，不要说「看不到之前的文件」。',
  '给用户看的最终回复直接写成自然文本，不要包代码块、不要追加自我说明。',
].join('\n');

/**
 * 上下文窗口常量。
 *
 * 数值出处（2026-11-19 调整，目的：减少 tool-calling 分片带来的重复发送与模型往返）：
 * - `maxCharsPerMessage` 原为 2000（旧注释只写「沿用既有常量」，无出处）。实测本项目
 *   配方里 4 个真实接口完整响应：qt.gtimg.cn 单只行情 539 字符、holidayAPI.json
 *   13,658 字符、wttr.in format=j1 39,216 字符、同花顺新闻 100 条 101,438 字符，
 *   没有一个能装进 2000。分片数随正文线性增长，而标准 tool-calling 每轮要重发
 *   此前全部观察，累计发送量近似平方级（实测 20k 正文 / 2000 上限 = 11 次请求、
 *   131,865 字符，是正文的 6.6 倍）。
 * - 新值 8000 = **项目既有的 `maxTotalChars` 原值**，不是外部抄来的默认值：
 *   把「单条上限」与「总预算」原本互相打架的两个数统一到同一个量级，
 *   不引入新的 magic number。含义为「一次允许给模型的单条文本量」。
 * - `maxTotalChars` 32000 = 4 × 单条上限。这个 4 倍是**明说的业务约束**：
 *   允许一条完整观察（最多 8000）与若干历史消息共存，不至于一条大观察把
 *   20 条历史全挤掉。倍数可争议、可改，不是从验证集扫出来的。
 *   不放更大，是为了避免长上下文「lost in the middle」注意力衰减；
 *   超长文档仍保留 web_cache_read 的 grep / slice 兜底，不追求一次给全。
 * - `maxMessages: 20` 不变（沿用既有窗口）。
 *
 * 注意：本常量被 6 处共用（历史消息截断、ToolLoop.clipObservation、web_fetch
 * 预览/直给、web_cache_read 分片、kv_slice、prefs 单值上限），调整时它们一起变化。
 */
export const CONTEXT_LIMITS = {
  /** 最多带多少条历史消息（user + assistant 合计）。附件随所在消息受此约束 */
  maxMessages: 20,
  /** 单条消息文本字符上限。附件 base64 不计入（决策 5A，否则图片必被截成半张） */
  maxCharsPerMessage: 8000,
  /** 发给模型的上下文总字符预算（不含 system、不含附件 base64）。= 4 × 单条上限 */
  maxTotalChars: 32000,
} as const;

// 会话标题已独立到 SessionTitle.ts（模型精炼 + 统一展示上限）。
// 本文件只负责「发给模型的上下文」，不再掺和标题口径，避免出现两个上限。

/** 会话消息形状：附件是独立字段，不进 content */
export interface ConversationHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: readonly ChatAttachment[];
}

/** 带完整历史下标的窗口消息：compact 要用它算压缩边界 */
export type WindowedMessage = ConversationHistoryMessage & { historyIndex: number };

/** 窗口规划结果：`kept` 是连续最新一段，`dropped` 是它之前的全部旧消息 */
export interface ConversationWindowPlan {
  kept: ReadonlyArray<WindowedMessage>;
  dropped: ReadonlyArray<WindowedMessage>;
}

/**
 * 计算本轮模型可见窗口 —— **唯一裁剪口径**。
 *
 * `buildConversationMessages()` 与 `ConversationCompactor` 都消费这个函数：
 * 前者拿 kept 构造上下文，后者拿 dropped 作为 compact 的触发判据与摘要输入。
 * 因此「有旧消息被丢」是严格可观测的事实，不需要另设「快满了」的比例阈值，
 * 也不会出现「压缩边界」与「实际发送的历史」对不上的劈叉。
 *
 * 裁剪顺序：先限条数 → 再截单条文本 → 最后按总文本预算从最旧开始丢，
 * 保证最后一条（当前句）一定保留。字符预算只累计文本；
 * 附件 base64 转成 ModelPart 后挂在同一条消息上，不参与累加（决策 5A）。
 */
export function planConversationWindow(
  history: ReadonlyArray<ConversationHistoryMessage>,
): ConversationWindowPlan {
  // 完整历史逐条编号（单条文本按同一上限截断），dropped 才能覆盖「被条数上限
  // 整段挤出去」的旧消息 —— 长会话里那才是主要情形，不能只看窗口内被预算丢的几条。
  // 用展开保留原始消息的其它字段（尤其 timestamp）：checkpoint 的 fromTs/toTs
  // 来自这里，不能因为重建窗口消息就把时间抹掉。
  const all: WindowedMessage[] = history.map((m, i) => ({
    ...m,
    content: m.content.slice(0, CONTEXT_LIMITS.maxCharsPerMessage),
    historyIndex: i,
  }));
  const windowed = all.slice(-CONTEXT_LIMITS.maxMessages);

  // 从最新往回累加，超预算就停止（保留连续的最新一段，而不是挖掉中间）
  const kept: WindowedMessage[] = [];
  let total = 0;
  for (let i = windowed.length - 1; i >= 0; i--) {
    const msg = windowed[i]!;
    if (total + msg.content.length > CONTEXT_LIMITS.maxTotalChars && kept.length > 0) break;
    total += msg.content.length;
    kept.push(msg);
  }
  kept.reverse();

  const firstKept = kept.length > 0 ? kept[0]!.historyIndex : history.length;
  const dropped = all.filter((m) => m.historyIndex < firstKept);
  return { kept, dropped };
}

/**
 * 注入上下文的摘要段最小结构面。
 * 故意只声明用到的三个字段：`ConversationCompactor` 的完整 checkpoint 结构兼容它，
 * 但本文件不必 import compactor（避免循环依赖），也不把存储形状绑进上下文构造。
 */
export interface ConversationSummary {
  seq: number;
  summary: string;
  firstKeptIndex: number;
}

/**
 * 摘要段以**独立 system 消息**插在主 system 之后，而不是合并进 messages[0]。
 * 原因：ToolLoop 的 `systemPrompt` 是替换制，chat 角色拼装技能 / kv 后缀时会重写
 * messages[0]；合并进去会被冲掉。独立一条 system 不受替换影响，且端点普遍接受
 * 多条 system 消息。摘要明确标注「宿主生成 + 覆盖到哪一条」，不伪装成用户原话。
 */
function summaryMessage(s: ConversationSummary): ModelMessageForPrompt {
  return {
    role: 'system' as const,
    content: [
      `【此前对话摘要｜宿主 compact 生成，第 ${s.seq} 版】`,
      `摘要覆盖完整历史中第 0 ~ ${s.firstKeptIndex - 1} 条消息；完整原文仍在会话历史里，本轮不再逐字发送。`,
      '以下要点与当前问题相关时请直接沿用，不要要求用户重复已经说过的内容：',
      s.summary,
    ].join('\n'),
  };
}

/** WindowedMessage → 发给模型的消息（文本 + 附件 parts） */
function toPromptMessage(m: WindowedMessage): ModelMessageForPrompt {
  if (!m.attachments || m.attachments.length === 0) {
    return { role: m.role, content: m.content };
  }
  const parts: ModelPart[] = [
    { type: 'text', text: m.content },
    ...attachmentsToModelParts(m.attachments as ChatAttachment[]),
  ];
  return { role: m.role, content: parts };
}

/**
 * 从「当前会话的全部消息（含刚写入的当前句）」构造发给模型的消息数组。
 *
 * 下一轮上下文 = [主 system] + [可选摘要] + [最近 kept（含当前句）]。
 * 不传 summary 时与旧版逐字一致（既有装配与测试不用改）。
 */
export function buildConversationMessages(
  history: ReadonlyArray<ConversationHistoryMessage>,
  summary?: ConversationSummary,
): Array<ModelMessageForPrompt> {
  return [
    { role: 'system' as const, content: CONVERSATION_SYSTEM_PROMPT },
    ...(summary ? [summaryMessage(summary)] : []),
    ...planConversationWindow(history).kept.map(toPromptMessage),
  ];
}

/**
 * 溢出恢复用的最小上下文：[主 system] + [可选摘要] + [当前句]。
 *
 * 来源明说（不是扫出来的阈值）：端点报「上下文超限」说明宿主本轮给出的文本量
 * 超过它容量；宿主能立刻减量、且仍必须保留当前用户这一句的唯一动作就是把窗口
 * 收到最小（1 条 = 当前句）。已有摘要照常注入，因此旧信息不会比正常轮次更亏。
 * 只在「同一 turn 溢出重试一次」这条路径调用，不改任何窗口常量。
 */
export function buildOverflowFallbackMessages(
  history: ReadonlyArray<ConversationHistoryMessage>,
  summary?: ConversationSummary,
): Array<ModelMessageForPrompt> {
  const { kept } = planConversationWindow(history);
  const tail = kept.length > 0 ? [toPromptMessage(kept[kept.length - 1]!)] : [];
  return [
    { role: 'system' as const, content: CONVERSATION_SYSTEM_PROMPT },
    ...(summary ? [summaryMessage(summary)] : []),
    ...tail,
  ];
}

/** 返回结构：与 ModelMessage 对齐 */
type ModelMessageForPrompt = {
  role: 'system' | 'user' | 'assistant';
  content: string | ModelPart[];
};

// 标题兜底见 SessionTitle.clampTitle：按 Unicode 码点截断，不碰附件字段。
