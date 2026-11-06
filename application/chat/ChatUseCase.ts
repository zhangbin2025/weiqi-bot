/**
 * 对话用例
 * @module application/chat/ChatUseCase
 *
 * 职责：处理一条用户消息 —— 渲染、写历史、拼上下文、调模型网关、渲染回复。
 *
 * 分流依据不再是「猜这句话属于哪个意图」，而是**用户显式选定的模型角色**
 * （见 ChatRole）：
 * - chat 角色：纯聊天对象，ConversationPrompt + 普通模型调用，模型完全看不到
 *   插件系统、没有 JSON 协议、没有任何写权限。
 * - plugin 角色：可编程智能体，插件快照 + 沙箱契约 + JSON 动作协议 + Agent Loop，
 *   能真实执行查看/新建/启停/删除；此角色下所有消息都进 Agent。
 *
 * 角色由页面注入（roleProvider），用例本身不持久化、不猜测。插件能力的数据
 * 来源是工件存储，不是会话历史，因此会话清空/新建都不影响。
 *
 * 「插件调试过程」只在 plugin 角色下展示，且**发送瞬间就点亮**：模型调用前
 * 那段几十秒的等待期也有可见的实时进度。
 */

import type { IModelGateway } from '../model/IModelGateway';
import type { ChatHistoryManager } from '../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../assistant/IMessageRenderer';
import { buildConversationMessages, summarizeSession } from './ConversationPrompt';
import { isDebugTraceStep, visibleDebugSteps } from './PluginTraceVisibility';
import { getRole, type ChatRoleId } from './ChatRole';
import type { AgentTurnRequest } from '../plugin/PluginAgentUseCase';
import type { AgentTurnResult, PluginTraceStep } from '@domain/plugin/types';

/** 拦截「/」开头：chat 页零命令体系，配置请回功能助手 */
export const SLASH_COMMAND_HINT = '对话页不支持命令，模型配置请回到功能助手操作。';
export const NOT_READY_HINT = '尚未配置 LLM，请回到功能助手执行 /llm 配置后再来对话。';

/** 选了插件角色但插件系统装配失败时的提示（页面始终可用，不抛错） */
export const AGENT_UNAVAILABLE_HINT =
  '插件系统未能加载，当前无法使用「插件开发」角色。请刷新重试，或切回「闲聊」角色继续对话。';

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
    /** 可选：装配后，仅 plugin 角色的消息才获得插件编程能力 */
    private readonly agent?: IPluginAgent,
    /** 当前角色由页面提供（角色绑定会话）。不传则默认闲聊。 */
    private readonly roleProvider?: () => ChatRoleId,
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

    // 角色在发送这一刻确定，整条消息只走这一条路径。
    const role = getRole(this.roleProvider?.() ?? 'chat');

    // 用户气泡 + 落盘
    await this.renderer.renderMessage(text, true, null, null, undefined, undefined, false);
    await this.history.addMessage({ role: 'user', content: text });
    // 首条消息生成会话摘要/标题（用户要求：第一条消息截断）
    if (this.history.getMessages().filter((m) => m.role === 'user').length === 1) {
      await this.history.setCurrentSessionTitle(summarizeSession(this.history.getMessages()));
    }

    // 选了插件角色但插件系统没装上：给明确提示，不静默降级成闲聊
    // （静默降级正是「说已启用却没执行」那类假成功的温床）
    if (role.agent && !this.agent) {
      this.renderer.hideTyping();
      await this.renderHint(AGENT_UNAVAILABLE_HINT);
      return;
    }

    const useAgent = role.agent;
    // 过程块是否允许出现，由角色决定；但**是否真的出现，由本轮实际产生的
    // 步骤决定** —— 懒建：只有第一个实质调试步骤到达时才 beginPluginTrace。
    //
    // 为什么不能「发送瞬间就建」：plugin 角色下「启用」「看一下插件列表」
    // 也走 Agent，但它们只产生 decision/observe/final，没有任何代码调试。
    // 无条件预建会让每句话都挂一个「插件调试过程」空壳，正是本次要修的。
    // 区分依据是 Agent 真的干了什么（有没有走 codegen），不是逐句猜措辞，
    // 也不退回按消息文本判意图。
    const showTrace = role.trace && useAgent;
    this.renderer.showTyping();

    let realtime = false;
    let started = false;
    let beginAttempted = false; // begin 只试一次，失败就交给全量兜底，不逐步重试
    let lastStepOk = true;
    const hasRealtimeRenderer = Boolean(
      this.renderer.beginPluginTrace && this.renderer.appendPluginTraceStep,
    );
    /** 懒建：收到第一个值得展示的步骤时才点亮过程块，返回是否已建好 */
    const ensureStarted = (): boolean => {
      if (!showTrace || !hasRealtimeRenderer || started || beginAttempted) return started;
      beginAttempted = true;
      try {
        realtime = this.renderer.beginPluginTrace!() === true;
        started = realtime;
      } catch { /* 纯展示，吞掉 */ }
      return started;
    };
    const onTrace = hasRealtimeRenderer
      ? (step: PluginTraceStep): void => {
          // 只放行实质调试步骤（代码/校验/试算）；decision/observe/final
          // 一概不触发建块，也不追加 —— 与全量兜底同一套口径。
          if (!showTrace || !isDebugTraceStep(step)) return;
          if (!ensureStarted()) return;
          try {
            this.renderer.appendPluginTraceStep!(step);
            lastStepOk = step.ok;
          } catch { /* 纯展示，吞掉 */ }
        }
      : undefined;

    try {
      const result = useAgent ? await this.runAgent(text, onTrace) : undefined;
      const reply = result ? result.reply : await this.runPlainChat();
      this.renderer.hideTyping();

      // 兜底：渲染器不支持实时、或 begin 返回 false → 结束后一次性全量渲染。
      // 同样只在 plugin 角色下，且只渲染实质调试步骤。
      // 实时模式的收尾统一放在 finally，正常/异常都只做一次。
      const visible = showTrace ? visibleDebugSteps(result?.trace) : [];
      if (!realtime && visible.length > 0 && this.renderer.renderPluginTrace) {
        try { await this.renderer.renderPluginTrace(visible); } catch { /* ignore */ }
      }

      // 安全边界保持不变：装配了插件系统时，所有回复（含闲聊角色）都经
      // safeReply 转义+截断。渲染器用 innerHTML 解析 markdown，这里是唯一的
      // HTML 转义防线，不能因为分流而绕过。
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

  /** 闲聊角色：会话 system prompt + 普通模型调用，模型看不到插件系统 */
  private async runPlainChat(): Promise<string> {
    const messages = buildConversationMessages(this.history.getMessages());
    const result = await this.gateway.execute({
      task: 'chat.reply',
      messages,
      options: { jsonMode: false },
    });
    return result.text;
  }

  /** 插件角色：会话历史只作聊天上下文，插件能力来自工件 */
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
