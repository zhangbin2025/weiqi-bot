/**
 * 对话用例
 * @module application/chat/ChatUseCase
 *
 * 职责：处理一条用户消息 —— 渲染、写历史、拼上下文、调模型网关、渲染回复。
 *
 * 对话页是「智能体主控台」，可编程（编写/修改插件）是一等能力：
 * 装配了 PluginAgent 时走 Agent Loop（模型产出动作 → 执行 → 观测 → 再决策）；
 * 未装配或装配失败时自动降级为纯聊天，保证对话页永远可用。
 * 插件能力的数据来源是工件存储，不是会话历史，因此会话清空/新建都不影响。
 */

import type { IModelGateway } from '../model/IModelGateway';
import type { ChatHistoryManager } from '../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../assistant/IMessageRenderer';
import { buildConversationMessages, summarizeSession } from './ConversationPrompt';
import type { AgentTurnRequest } from '../plugin/PluginAgentUseCase';
import type { AgentTurnResult } from '@domain/plugin/types';

/** 拦截「/」开头：chat 页零命令体系，配置请回功能助手 */
export const SLASH_COMMAND_HINT = '对话页不支持命令，模型配置请回到功能助手操作。';
export const NOT_READY_HINT = '尚未配置 LLM，请回到功能助手执行 /llm 配置后再来对话。';

/** 智能体端口：与 PluginAgentUseCase.turn 对齐，避免 application/chat 依赖具体实现 */
export interface IPluginAgent {
  /** onTrace 通过 AgentTurnRequest.onTrace 传入（单参接口，兼容旧实现） */
  turn(req: AgentTurnRequest): Promise<AgentTurnResult>;
  /** 渲染前安全处理 LLM 文本（转义 + 截断） */
  safeReply(text: string): string;
}

export function isSlashCommand(text: string): boolean {
  return text.trim().startsWith('/');
}

export class ChatUseCase {
  constructor(
    private readonly gateway: IModelGateway,
    private readonly history: ChatHistoryManager,
    private readonly renderer: IMessageRenderer,
    /** 可选：装配后对话页获得插件编程能力；未装配则保持纯聊天 */
    private readonly agent?: IPluginAgent,
  ) {}

  isReady(): boolean {
    return this.gateway.isReady();
  }

  /**
   * 发送一条用户消息。
   *
   * 安全边界：
   * - 「/」开头只渲染提示，不渲染用户气泡、不写历史 —— 避免 /llm 里的
   *   apiKey 明文落进 IndexedDB 并出现在导出文件里。
   * - 模型失败时只渲染错误提示、**不写进历史**，否则错误文案会在下一轮
   *   被当上下文带进去污染对话。用户消息本身仍保留（用户确实发了）。
   * - Agent 回复经 safeReply 转义后再交给渲染器（渲染器用 marked 解析 HTML）。
   */
  async send(text: string): Promise<void> {
    if (isSlashCommand(text)) {
      await this.renderHint(SLASH_COMMAND_HINT);
      return;
    }
    if (!this.gateway.isReady()) {
      await this.renderHint(NOT_READY_HINT);
      return;
    }

    // 用户气泡 + 落盘
    await this.renderer.renderMessage(text, true, null, null, undefined, undefined, false);
    await this.history.addMessage({ role: 'user', content: text });
    // 首条消息生成会话摘要/标题（用户要求：第一条消息截断）
    if (this.history.getMessages().filter((m) => m.role === 'user').length === 1) {
      await this.history.setCurrentSessionTitle(summarizeSession(this.history.getMessages()));
    }

    this.renderer.showTyping();
    // 实时过程日志：懒开启（收到第一步才建块，纯闲聊不会留空块）、逐步追加、finally 收尾。
    // 渲染器不支持实时模式时，回退到「结束后一次性全量渲染」。
    let realtime = false;
    let started = false;
    let lastStepOk = true;
    const onTrace = this.renderer.beginPluginTrace && this.renderer.appendPluginTraceStep
      ? (step: import('@domain/plugin/types').PluginTraceStep): void => {
          // 纯展示：任何渲染异常都吞掉，绝不能把主回复弄丢
          try {
            if (!started) {
              realtime = this.renderer.beginPluginTrace!() === true;
              started = true;
            }
            if (realtime) {
              this.renderer.appendPluginTraceStep!(step);
              lastStepOk = step.ok;
            }
          } catch { /* ignore */ }
        }
      : undefined;

    try {
      const result = this.agent ? await this.runAgent(text, onTrace) : undefined;
      const reply = result ? result.reply : await this.runPlainChat();
      this.renderer.hideTyping();

      // 兜底：渲染器不支持实时、或 agent 没走实时通道 → 结束后一次性全量渲染。
      // 实时模式的收尾统一放在 finally，正常/异常都只做一次。
      if (!realtime && result?.trace && result.trace.length > 0 && this.renderer.renderPluginTrace) {
        try { await this.renderer.renderPluginTrace(result.trace); } catch { /* ignore */ }
      }

      const safe = this.agent ? this.agent.safeReply(reply) : reply;
      if (!safe.trim()) {
        await this.renderHint('模型没有返回内容，请稍后重试或更换模型。');
        return;
      }
      await this.renderer.renderMessage(
        safe, false, null, null, undefined, undefined, true,
      );
      // 历史里只有干净的 user/assistant 文本，trace 永远不进来
      await this.history.addMessage({ role: 'assistant', content: safe });
    } catch (error) {
      this.renderer.hideTyping();
      lastStepOk = false;
      const message = error instanceof Error ? error.message : String(error);
      await this.renderHint(`❌ 对话失败：${message}`);
    } finally {
      // 实时块统一收尾：标题定稿、折叠回去；异常路径也不会一直挂「进行中…」
      if (realtime && started && this.renderer.finishPluginTrace) {
        try { this.renderer.finishPluginTrace(lastStepOk); } catch { /* ignore */ }
      }
    }
  }

  /** 纯聊天路径（无插件系统时的既有行为，保持不变） */
  private async runPlainChat(): Promise<string> {
    const messages = buildConversationMessages(this.history.getMessages());
    const result = await this.gateway.execute({
      task: 'chat.reply',
      messages,
      options: { jsonMode: false },
    });
    return result.text;
  }

  /** 智能体路径：会话历史只作聊天上下文，插件能力完全来自工件 */
  private async runAgent(
    text: string,
    onTrace?: (step: import('@domain/plugin/types').PluginTraceStep) => void,
  ): Promise<AgentTurnResult> {
    const agent = this.agent!;
    const history = buildConversationMessages(this.history.getMessages())
      .filter((m) => m.role !== 'system')
      .slice(0, -1) // 去掉当前句（由 turn 的 text 传入）
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : '',
      }));
    // conversationRef 只是可选引用，取不到不影响任何插件能力（工件中心）
    const getCurrent = (this.history as { getCurrentSession?: () => { sessionId: string } | null }).getCurrentSession;
    const sessionId = typeof getCurrent === 'function'
      ? getCurrent.call(this.history)?.sessionId
      : undefined;
    const result = await agent.turn({
      text,
      history,
      ...(sessionId ? { conversationRef: sessionId } : {}),
      ...(onTrace ? { onTrace } : {}),
    });
    return result;
  }

  /** 提示类消息：只渲染，绝不写历史 */
  private async renderHint(text: string): Promise<void> {
    await this.renderer.renderMessage(
      text, false, null, null, undefined, undefined, false,
    );
  }
}
