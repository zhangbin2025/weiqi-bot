/**
 * 标准 tool-calling agent loop
 * @module application/chat/WebToolLoop
 *
 * 这是「智能体」的控制核心，形状遵循 OpenAI / Anthropic 通用 tool-calling 规范：
 *   tools 声明能力 → 模型自主决定是否 tool_calls → 宿主执行工具 →
 *   role:'tool' 回填观察 → 再决策 → 直到模型给出最终文本或轮数用尽。
 *
 * 决策权在模型：宿主不预先编排「第几步该取网页」，也不按用户措辞猜意图。
 * 宿主只提供工具集合与观察通道。新增能力 = 往 tools[] 里加一项 + 一个执行器，
 * loop 本身零改动 —— 这就是「一步到位」的架构含义。
 *
 * 与 PluginAgentUseCase 的区别：那边是插件专用的自定义 JSON action 协议
 * （{reply, action.kind}，动作集合封闭在插件增删改），不是标准智能体规范；
 * 本文件不复用它，也不碰插件沙箱。
 *
 * 数值口径（不新造常量，全部沿用已有且可追溯的来源）：
 * - 决策轮数上限：DEFAULT_PLUGIN_MAX_ATTEMPTS + 1，与 PluginAgentUseCase 同机制
 * - 上下文裁剪：CONTEXT_LIMITS（buildConversationMessages 已内置，本文件不重复截断）
 * - 工具访问超时：调用方注入的 config.timeoutMs（LLMCredentialStore 已配置值）
 * - LLM 超时 / 输出预算：LLMCredentialStore 已配置值，由网关读取
 */

import type {
  IModelGateway, ModelMessage, ModelToolCall, ModelToolDefinition,
} from '../model/IModelGateway';
import type { PluginTraceStep } from '@domain/plugin/types';
import { DEFAULT_PLUGIN_MAX_ATTEMPTS } from '../plugin/PluginConfig';
import { WEB_FETCH_TOOL, WEB_FETCH_TOOL_NAME, executeWebFetch } from './WebFetchTool';
import type { WebFetchToolDeps } from './WebFetchTool';

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
  /** 实际决策轮数 */
  turns: number;
  /** 是否因轮数用尽而终止（模型未给出最终文本） */
  exhausted: boolean;
}

/** 工具表：唯一的扩展点，新增能力在这里登记 */
const TOOLS: ModelToolDefinition[] = [WEB_FETCH_TOOL];

/** 未知工具名时回给模型的观察，避免 loop 静默卡死 */
function unknownToolObservation(name: string): string {
  return `未知工具「${name}」。当前可用工具只有 ${WEB_FETCH_TOOL_NAME}。`;
}

/**
 * 跑一次完整的 agent turn。
 *
 * 历史消息由调用方用 buildConversationMessages 构造（含裁剪），本函数只在
 * 内存里往后追加 assistant(tool_calls) 与 tool 观察；这些中间消息**不落会话历史**
 * —— 与 PluginAgentUseCase 一致：历史只存干净的 user/assistant 文本。
 */
export async function runWebToolLoop(
  deps: WebToolLoopDeps,
  req: WebToolLoopRequest,
): Promise<WebToolLoopResult> {
  const messages: ModelMessage[] = [...req.messages];
  const trace: WebTraceStep[] = [];
  // 沿用已有常量：与 PluginAgentUseCase 相同的「maxAttempts+1 次决策」机制
  const maxTurns = Math.max(1, DEFAULT_PLUGIN_MAX_ATTEMPTS) + 1;

  const push = (attempt: number, phase: string, ok: boolean, detail: string): void => {
    const step: WebTraceStep = { source: 'web', attempt, phase, ok, detail };
    trace.push(step);
    try { req.onTrace?.(step); } catch { /* 纯展示，单步失败不影响主流程 */ }
  };

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
      return {
        reply: `模型调用失败：${reason}`,
        trace,
        turns: turn,
        exhausted: false,
      };
    }

    const calls = result.toolCalls ?? [];
    if (calls.length === 0) {
      // 模型没要工具 → 本轮文本就是最终回复。空文本交给上层统一给提示。
      push(turn, 'final', true, '模型给出最终回复，未访问网络');
      return {
        reply: result.text,
        trace,
        turns: turn,
        exhausted: false,
      };
    }

    // 把 assistant 的 tool_calls 原样放进消息，端点要求它后面跟逐条 tool 观察
    messages.push({
      role: 'assistant',
      content: result.text,
      tool_calls: calls,
    });

    for (const call of calls) {
      const observation = await runOneTool(call, deps.toolDeps);
      push(turn, 'observe', observation.ok, `${call.name}：${observation.detail}`);
      messages.push({
        role: 'tool',
        content: observation.observation,
        tool_call_id: call.id,
      });
    }
    // 观察已回填，进入下一轮决策（模型可继续取别的 URL，也可收敛给答案）
  }

  push(maxTurns, 'final', false, `已达决策轮数上限（${maxTurns} 轮），未得到最终回复`);
  return {
    reply: `已达到本轮最大决策次数（${maxTurns} 次），未能给出最终答案。请缩小问题或稍后重试。`,
    trace,
    turns: maxTurns,
    exhausted: true,
  };
}

async function runOneTool(
  call: ModelToolCall,
  toolDeps: WebFetchToolDeps,
): Promise<{ observation: string; ok: boolean; detail: string }> {
  if (call.name !== WEB_FETCH_TOOL_NAME) {
    return {
      observation: unknownToolObservation(call.name),
      ok: false,
      detail: `未知工具 ${call.name}`,
    };
  }
  return executeWebFetch(call.arguments, toolDeps);
}
