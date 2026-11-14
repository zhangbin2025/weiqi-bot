/**
 * 通用 tool-calling agent loop
 * @module application/chat/ToolLoop
 *
 * 形状遵循 OpenAI / Anthropic 通用 tool-calling 规范：
 *   tools 声明能力 → 模型自主决定是否 tool_calls → 宿主执行工具 →
 *   role:'tool' 回填观察 → 再决策 → 直到模型给出最终文本或轮数用尽。
 *
 * 决策权在模型：宿主不预先编排「第几步该做什么」，只提供工具集合与观察通道。
 * 新增能力 = 往 tools[] 登记一个声明 + 往 executors{} 登记一个执行器，
 * 不改循环本身。这是「闲聊」与「插件开发」共用的唯一引擎：
 * 两个角色的差别只是挂哪套 tools / 注入哪段 system / trace 用什么标题。
 *
 * 2026-11-13 的多模态约定（沿用，不改协议形状）：
 * 图片 / 原生 PDF 的 base64 不能塞进 role:'tool' 的字符串，工具执行后若
 * 产出 parts，loop 在观察之后追加一条多模态 user 消息；附件收集进结果
 * 供上层落历史，支持多轮追问。
 *
 * 数值口径（全部沿用已有、可追溯的来源，不新造常量）：
 * - 自主决策轮数上限：DEFAULT_PLUGIN_MAX_ATTEMPTS + 1（maxTurns，见 PluginConfig.ts；
 *   可用 `/llm repairs` 配置）。只有「实质动作」才计一次自主决策：
 *   状态变更工具 / 普通工具 / 未知工具 / 最终文本。
 * - 延续（不占决策预算）：确定性验收失败后的重写(ToolOutcome.repairable) 与
 *   只读准备工具的观察(ToolOutcome.preparatory)。这两类只是「同一次决策里没产生
 *   实质动作」的轮次，不推进 decisions。标准 tool-calling 把一个意图摊成多步工具往返，
 *   不豁免的话第一次开发就会被只读准备动作吃光 maxTurns。
 *   chat/web 角色的工具从不置位这两个标记，逐字沿用「每轮一次决策」的旧行为。
 * - 总调用轮数 guard：maxTurns × maxTurns。唯一作用是防止豁免后无限循环，
 *   来源明说：还原旧架构「外层最多 maxTurns 个粗粒度动作 × 每个动作内最多
 *   maxTurns 次模型调用（含 codegen 修复）」的实际预算规模；随 /llm repairs 联动，
 *   不是扫验证集挑的经验值。到顶如实报「总调用轮数上限」，不谎报「未推进到实质操作」。
 *   ⚠️ 不要再加「连续 N 次延续就封顶」：合理的多步只读迭代次数不可预知，
 *   任何固定 N 都会误杀（2026-11-15 实测 debug×3 全成功却被判打转、报最终失败）。
 * - 观察文本裁剪：CONTEXT_LIMITS.maxCharsPerMessage（与历史构造一致）
 * - 附件 base64 不计入字符预算，随所在消息受 maxMessages 窗口约束
 */

import type {
  IModelGateway, ModelMessage, ModelToolCall, ModelToolDefinition, ModelPart,
} from '../model/IModelGateway';
import type { PluginTraceStep } from '@domain/plugin/types';
import type { ChatAttachment } from './ChatAttachment';
import { CONTEXT_LIMITS } from './ConversationPrompt';
import { DEFAULT_PLUGIN_MAX_ATTEMPTS } from '../plugin/PluginConfig';

/** 一次工具执行的统一形状。失败一律变成 observation 回喂，不抛给 loop。 */
export interface ToolOutcome {
  /** 回填给模型的观察文本（role:'tool'） */
  observation: string;
  /** 是否成功（用于过程块标记 ok） */
  ok: boolean;
  /** 一行人话摘要（过程块显示） */
  detail: string;
  /** 需要追加的多模态 user 消息片段 */
  parts?: ModelPart[];
  /** 需要落历史的附件 */
  attachment?: ChatAttachment;
  /** 本轮涉及的完整源码，交给过程块「查看本轮代码」展示（可选） */
  code?: string;
  /**
   * 本轮观察是一次「确定性验收失败」（模型提交的源码没过试算，需重写）。
   * 语义：这是同一次自主决策的延续，不计入决策轮数上限；连续失败次数由
   * loop 按 maxTurns - 1（= maxAttempts）封顶。仅插件工具集在试算失败时置位，
   * 其它工具 / 其它角色一律不置位，避免在共用引擎里悄悄改变 chat 的行为。
   */
  repairable?: boolean;
  /**
   * 本轮观察来自「只读准备工具」（plugin_list/show/history/debug 这类只查不改的动作）。
   * 语义：标准 tool-calling 下一个意图会串多步只读查询，它们不是独立的自主决策，
   * 与 repairable 一样计为同一次决策的延续，不占决策预算（共用连续延续上限）。
   * 仅插件工具集的只读工具置位；状态变更工具与 chat/web 工具一律不置位。
   */
  preparatory?: boolean;
}

/** 工具执行器：入参是端点给的字符串，由实现自行 JSON.parse */
export type ToolExecutor = (argsJson: string) => Promise<ToolOutcome>;

/** 一套可挂到 loop 上的能力：声明 + 执行器 + 角色 system */
export interface ToolKit {
  tools: ModelToolDefinition[];
  executors: Record<string, ToolExecutor>;
  /** 静态文本或每轮动态生成（插件清单要实时读工件存储） */
  systemPrompt?: string | (() => Promise<string>);
  /** 可选：覆盖默认自主决策轮数上限（沿用 /llm repairs 配置时由插件系统传入） */
  maxTurns?: number;
}

export interface ToolLoopDeps {
  gateway: IModelGateway;
  tools: ModelToolDefinition[];
  executors: Record<string, ToolExecutor>;
  /** 有值时替换/补上 messages 里的 system 消息 */
  systemPrompt?: string | (() => Promise<string>);
  /** trace 的来源标签，供展示层区分过程块 */
  source?: PluginTraceStep['source'];
  /** 自主决策轮数上限；不传用 DEFAULT_PLUGIN_MAX_ATTEMPTS + 1。修复/只读延续不占此预算 */
  maxTurns?: number;
}

export interface ToolLoopRequest {
  /** 已含 system + 历史 + 当前句的完整消息数组 */
  messages: ModelMessage[];
  onTrace?: (step: PluginTraceStep) => void;
}

export interface ToolLoopResult {
  reply: string;
  /** 完整过程记录（含未展示的步骤），不写会话历史 */
  trace: PluginTraceStep[];
  /** 本轮工具读到的资源附件，交给上层落到用户消息上（多轮追问） */
  attachments: ChatAttachment[];
  /** 实际决策轮数 */
  turns: number;
  /** 是否因轮数用尽而终止（模型未给出最终文本） */
  exhausted: boolean;
}

/** 观察文本沿用 CONTEXT_LIMITS.maxCharsPerMessage 裁剪；截断点给模型可见提示 */
function clipObservation(text: string): string {
  if (text.length <= CONTEXT_LIMITS.maxCharsPerMessage) return text;
  const tail = '\n\n[观察内容超过单条消息字符上限，后段已截断；如需其余部分请换更精确的资源或分页读取]';
  return text.slice(0, Math.max(0, CONTEXT_LIMITS.maxCharsPerMessage - tail.length)) + tail;
}

function unknownToolObservation(name: string, tools: ModelToolDefinition[]): string {
  return `未知工具「${name}」。当前可用工具：${tools.map((t) => t.name).join('、')}。`;
}

/**
 * 跑一次完整的 agent turn。
 *
 * 历史消息由调用方用 buildConversationMessages 构造（含裁剪），本函数只在
 * 内存里往后追加 assistant(tool_calls) / tool 观察 / 多模态 user 消息；
 * 这些中间消息**不落会话历史**。工具读到的资源通过 attachments 返回。
 */
export async function runToolLoop(
  deps: ToolLoopDeps,
  req: ToolLoopRequest,
): Promise<ToolLoopResult> {
  const messages: ModelMessage[] = [...req.messages];
  const trace: PluginTraceStep[] = [];
  const attachments: ChatAttachment[] = [];
  const source = deps.source ?? 'web';
  const maxTurns = deps.maxTurns ?? Math.max(1, DEFAULT_PLUGIN_MAX_ATTEMPTS) + 1;

  // 角色 system：动态生成一次即可，后续轮次靠工具观察带新状态（标准 loop 语义）
  if (deps.systemPrompt) {
    const text = typeof deps.systemPrompt === 'function'
      ? await deps.systemPrompt()
      : deps.systemPrompt;
    if (messages.length > 0 && messages[0]!.role === 'system') {
      messages[0] = { role: 'system', content: text };
    } else {
      messages.unshift({ role: 'system', content: text });
    }
  }

  const push = (attempt: number, phase: string, ok: boolean, detail: string, code?: string): void => {
    const step: PluginTraceStep = { source, attempt, phase, ok, detail };
    if (code) step.code = code;
    trace.push(step);
    try { req.onTrace?.(step); } catch { /* 纯展示，单步失败不影响主流程 */ }
  };

  const done = (reply: string, turns: number, exhausted: boolean): ToolLoopResult =>
    ({ reply, trace, attachments, turns, exhausted });

  // 总调用轮数 guard：唯一防无限循环的硬约束，来源见头部口径（maxTurns × maxTurns）。
  // decisions 只数「实质动作」；repairable/preparatory 是同一次决策的延续，不推进 decisions，
  // 也不再累加任何「连续次数」——合理的只读迭代次数不可预知，固定封顶会误杀。
  const maxModelCalls = maxTurns * maxTurns;
  let decisions = 0;
  let modelCalls = 0;

  while (decisions < maxTurns) {
    modelCalls++;
    if (modelCalls > maxModelCalls) {
      push(decisions + 1, 'final', false,
        `已达到总调用轮数上限（${maxModelCalls}），未得到最终回复`);
      return done(
        `已达到总调用轮数上限（${maxModelCalls}，可用 /llm repairs 调整）。`
        + `请缩小问题或稍后重试。`,
        decisions + 1,
        true,
      );
    }

    const decisionNo = decisions + 1;
    push(decisionNo, 'decision', true, `第 ${decisionNo}/${maxTurns} 次决策：调用模型`);

    let result;
    try {
      result = await deps.gateway.execute({
        task: 'chat.reply',
        messages,
        tools: deps.tools,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      push(decisionNo, 'decision', false, `模型调用失败：${reason}`);
      return done(`模型调用失败：${reason}`, decisionNo, false);
    }

    const calls = result.toolCalls ?? [];
    if (calls.length === 0) {
      // 保留既有文案「未访问网络」：闲聊角色的 trace 断言依赖它，
      // 通用 loop 里同样成立（没有 tool_calls 就没访问任何工具/资源）。
      push(decisionNo, 'final', true, '模型给出最终回复，未访问网络');
      return done(result.text, decisionNo, false);
    }

    // 把 assistant 的 tool_calls 原样放进消息，端点要求它后面跟逐条 tool 观察
    messages.push({
      role: 'assistant',
      content: result.text,
      tool_calls: calls,
    });

    let allContinuation = true;
    for (const call of calls) {
      const outcome = await runOneTool(call, deps);
      push(decisionNo, 'observe', outcome.ok, `${call.name}：${outcome.detail}`, outcome.code);
      messages.push({
        role: 'tool',
        content: clipObservation(outcome.observation),
        tool_call_id: call.id,
      });
      if (outcome.parts && outcome.parts.length > 0) {
        const intro = `[工具 ${call.name} 返回的资源，请结合上面的观察阅读]`;
        messages.push({ role: 'user', content: [{ type: 'text', text: intro }, ...outcome.parts] });
      }
      if (outcome.attachment) attachments.push(outcome.attachment);
      // 只要有一个工具是实质动作，这一轮就计一次自主决策。
      if (!outcome.repairable && !outcome.preparatory) allContinuation = false;
    }

    if (!allContinuation) decisions++;
    // 延续轮：decisions 不动，观察已回填，下一轮模型可继续调工具或给最终答复。
  }

  push(maxTurns, 'final', false, `已达决策轮数上限（${maxTurns} 轮），未得到最终回复`);
  return done(
    `已达到本轮最大决策次数（${maxTurns} 次），未能给出最终答案。请缩小问题或稍后重试。`,
    maxTurns,
    true,
  );
}

async function runOneTool(call: ModelToolCall, deps: ToolLoopDeps): Promise<ToolOutcome> {
  const executor = deps.executors[call.name];
  if (!executor) {
    return {
      observation: unknownToolObservation(call.name, deps.tools),
      ok: false,
      detail: `未知工具 ${call.name}`,
    };
  }
  try {
    return await executor(call.arguments);
  } catch (error) {
    // 执行器理论上都自己把失败变观察；这里是最后一层保险，绝不让 loop 崩掉
    const reason = error instanceof Error ? error.message : String(error);
    return {
      observation: `工具 ${call.name} 执行异常：${reason}`,
      ok: false,
      detail: `执行异常：${reason}`,
    };
  }
}
