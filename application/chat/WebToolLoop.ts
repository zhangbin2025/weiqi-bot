/**
 * 标准 tool-calling agent loop
 * @module application/chat/WebToolLoop
 *
 * 这是「智能体」的控制核心，形状遵循 OpenAI / Anthropic 通用 tool-calling 规范：
 *   tools 声明能力 → 模型自主决定是否 tool_calls → 宿主执行工具 →
 *   role:'tool' 回填观察 → 再决策 → 直到模型给出最终文本或轮数用尽。
 *
 * 决策权在模型：宿主不预先编排「第几步该取网页」，也不按用户措辞猜意图。
 * 宿主只提供工具集合与观察通道。新增文本类能力 = 往 TOOLS[] 登记 + 一个执行器。
 *
 * 2026-11-13 补充：图片 / 原生 PDF 的 base64 不能塞进 role:'tool' 的字符串
 * （端点普遍不接受 tool 消息里的多模态 part）。工具执行后若产出 parts，
 * loop 在观察之后追加一条多模态 user 消息；并把附件收集进结果供上层落历史，
 * 支持多轮追问（用户决策第 6 点）。这是协议形状决定的，不是设计退化。
 *
 * 数值口径（不新造常量，全部沿用已有且可追溯的来源）：
 * - 决策轮数上限：DEFAULT_PLUGIN_MAX_ATTEMPTS + 1，与 PluginAgentUseCase 同机制
 * - 观察文本裁剪：CONTEXT_LIMITS.maxCharsPerMessage（工具观察此前完全不受
 *   裁剪，PDF 抽几万字会直接撑爆上下文；这里补上，口径与历史一致）
 * - 附件 base64：不计入字符预算（决策 5A），随所在消息受 maxMessages 窗口约束
 * - 工具访问超时：调用方注入的 config.timeoutMs（LLMCredentialStore 已配置值）
 */

import type {
  IModelGateway, ModelMessage, ModelToolCall, ModelToolDefinition, ModelPart,
} from '../model/IModelGateway';
import type { PluginTraceStep } from '@domain/plugin/types';
import { DEFAULT_PLUGIN_MAX_ATTEMPTS } from '../plugin/PluginConfig';
import { CONTEXT_LIMITS } from './ConversationPrompt';
import { WEB_FETCH_TOOL, WEB_FETCH_TOOL_NAME, executeWebFetch } from './WebFetchTool';
import type { WebFetchToolDeps } from './WebFetchTool';
import type { ChatAttachment } from './ChatAttachment';
import {
  WEB_READ_PDF_TOOL, WEB_READ_PDF_TOOL_NAME, WEB_READ_IMAGE_TOOL, WEB_READ_IMAGE_TOOL_NAME,
  executeWebReadPdf, executeWebReadImage,
} from './WebResourceTools';

/** 网络智能体过程步骤；source='web' 与插件调试步骤区分，展示层各自过滤 */
export type WebTraceStep = Omit<PluginTraceStep, 'source'> & { source: 'web' };

/** 实时过程推送（纯展示通道，绝不写会话历史） */
export type WebTraceSink = (step: WebTraceStep) => void;

export interface WebToolLoopDeps {
  gateway: IModelGateway;
  /** 工具执行依赖（proxyUrl / timeoutMs / 可替换 fetch） */
  toolDeps: WebFetchToolDeps;
}

export interface WebToolLoopRequest {
  /** 已含 system + 历史 + 当前句的完整消息数组 */
  messages: ModelMessage[];
  onTrace?: WebTraceSink;
}

export interface WebToolLoopResult {
  reply: string;
  /** 完整过程记录（含未展示的步骤），不写会话历史 */
  trace: WebTraceStep[];
  /** 本轮工具读到的资源附件，交给上层落到用户消息上（多轮追问） */
  attachments: ChatAttachment[];
  /** 实际决策轮数 */
  turns: number;
  /** 是否因轮数用尽而终止（模型未给出最终文本） */
  exhausted: boolean;
}

/** 工具表：唯一的扩展点，新增能力在这里登记 */
const TOOLS: ModelToolDefinition[] = [
  WEB_FETCH_TOOL,
  WEB_READ_PDF_TOOL,
  WEB_READ_IMAGE_TOOL,
];

/** 一次工具执行的统一形状 */
interface ToolOutcome {
  observation: string;
  ok: boolean;
  detail: string;
  /** 需要追加的多模态 user 消息片段 */
  parts?: ModelPart[];
  /** 需要落历史的附件 */
  attachment?: ChatAttachment;
}

/** 未知工具名时回给模型的观察，避免 loop 静默卡死 */
function unknownToolObservation(name: string): string {
  return `未知工具「${name}」。当前可用工具：${TOOLS.map((t) => t.name).join('、')}。`;
}

/** 工具注册表：名字 → 执行器。新增工具只改这张表 + TOOLS[] */
type ToolExecutor = (argsJson: string, deps: WebFetchToolDeps) => Promise<ToolOutcome>;
const EXECUTORS: Record<string, ToolExecutor> = {
  [WEB_FETCH_TOOL_NAME]: async (args, deps) => executeWebFetch(args, deps),
  [WEB_READ_PDF_TOOL_NAME]: async (args, deps) => executeWebReadPdf(args, deps),
  [WEB_READ_IMAGE_TOOL_NAME]: async (args, deps) => executeWebReadImage(args, deps),
};

/**
 * 观察文本沿用 CONTEXT_LIMITS.maxCharsPerMessage 裁剪。
 * 不新造常量；截断点给模型可见的提示，避免它以为内容完整而漏了后半段。
 */
function clipObservation(text: string): string {
  if (text.length <= CONTEXT_LIMITS.maxCharsPerMessage) return text;
  const tail = '\n\n[观察内容超过单条消息字符上限，后段已截断；如需其余部分请换更精确的资源或分页读取]';
  return text.slice(0, Math.max(0, CONTEXT_LIMITS.maxCharsPerMessage - tail.length)) + tail;
}

/**
 * 跑一次完整的 agent turn。
 *
 * 历史消息由调用方用 buildConversationMessages 构造（含裁剪），本函数只在
 * 内存里往后追加 assistant(tool_calls) / tool 观察 / 多模态 user 消息；
 * 这些中间消息**不落会话历史**。工具读到的资源通过 attachments 返回，
 * 由上层写进用户消息（决策第 6 点：落历史以支持多轮追问）。
 */
export async function runWebToolLoop(
  deps: WebToolLoopDeps,
  req: WebToolLoopRequest,
): Promise<WebToolLoopResult> {
  const messages: ModelMessage[] = [...req.messages];
  const trace: WebTraceStep[] = [];
  const attachments: ChatAttachment[] = [];
  // 沿用已有常量：与 PluginAgentUseCase 相同的「maxAttempts+1 次决策」机制
  const maxTurns = Math.max(1, DEFAULT_PLUGIN_MAX_ATTEMPTS) + 1;

  const push = (attempt: number, phase: string, ok: boolean, detail: string): void => {
    const step: WebTraceStep = { source: 'web', attempt, phase, ok, detail };
    trace.push(step);
    try { req.onTrace?.(step); } catch { /* 纯展示，单步失败不影响主流程 */ }
  };

  const done = (reply: string, turns: number, exhausted: boolean): WebToolLoopResult =>
    ({ reply, trace, attachments, turns, exhausted });

  for (let turn = 1; turn <= maxTurns; turn++) {
    push(turn, 'decision', true, `第 ${turn}/${maxTurns} 次决策：调用模型`);

    let result;
    try {
      result = await deps.gateway.execute({
        task: 'chat.reply',
        messages,
        tools: TOOLS,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      push(turn, 'decision', false, `模型调用失败：${reason}`);
      return done(`模型调用失败：${reason}`, turn, false);
    }

    const calls = result.toolCalls ?? [];
    if (calls.length === 0) {
      // 模型没要工具 → 本轮文本就是最终回复。空文本交给上层统一给提示。
      push(turn, 'final', true, '模型给出最终回复，未访问网络');
      return done(result.text, turn, false);
    }

    // 把 assistant 的 tool_calls 原样放进消息，端点要求它后面跟逐条 tool 观察
    messages.push({
      role: 'assistant',
      content: result.text,
      tool_calls: calls,
    });

    for (const call of calls) {
      const outcome = await runOneTool(call, deps.toolDeps);
      push(turn, 'observe', outcome.ok, `${call.name}：${outcome.detail}`);
      messages.push({
        role: 'tool',
        content: clipObservation(outcome.observation),
        tool_call_id: call.id,
      });
      if (outcome.parts && outcome.parts.length > 0) {
        // 端点不接受 tool 消息里的多模态 part：追加一条独立的 user 消息承载。
        // 文本引导让模型知道这是刚才那个工具读到的资源。
        const intro = `[工具 ${call.name} 返回的资源，请结合上面的观察阅读]`;
        messages.push({ role: 'user', content: [{ type: 'text', text: intro }, ...outcome.parts] });
      }
      if (outcome.attachment) attachments.push(outcome.attachment);
    }
    // 观察已回填，进入下一轮决策（模型可继续取别的 URL，也可收敛给答案）
  }

  push(maxTurns, 'final', false, `已达决策轮数上限（${maxTurns} 轮），未得到最终回复`);
  return done(
    `已达到本轮最大决策次数（${maxTurns} 次），未能给出最终答案。请缩小问题或稍后重试。`,
    maxTurns,
    true,
  );
}

async function runOneTool(
  call: ModelToolCall,
  toolDeps: WebFetchToolDeps,
): Promise<ToolOutcome> {
  const executor = EXECUTORS[call.name];
  if (!executor) {
    return {
      observation: unknownToolObservation(call.name),
      ok: false,
      detail: `未知工具 ${call.name}`,
    };
  }
  try {
    return await executor(call.arguments, toolDeps);
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
