/**
 * 对话用例
 * @module application/chat/ChatUseCase
 *
 * 职责：处理一条用户消息 —— 渲染、写历史、拼上下文、调模型网关、渲染回复。
 *
 * 分流依据不再是「猜这句话属于哪个意图」，而是**用户显式选定的模型角色**
 * （见 ChatRole）：
 * - chat 角色：标准 tool-calling 智能体。ConversationPrompt + WebToolLoop，
 *   模型自主决定要不要访问网页；网络工具的过程在「访问过程」块里实时展示。
 * - plugin 角色：可编程智能体，插件快照 + 沙箱契约 + JSON 动作协议 + Agent Loop，
 *   能真实执行查看/新建/启停/删除；此角色下所有消息都进 Agent。
 *
 * 角色由页面注入（roleProvider），用例本身不持久化、不猜测。插件能力的数据
 * 来源是工件存储，不是会话历史，因此会话清空/新建都不影响。
 *
 * 「插件调试过程」只在 plugin 角色下展示，且**发送瞬间就点亮**：模型调用前
 * 那段几十秒的等待期也有可见的实时进度。chat 角色的网络访问走另一套过程块，
 * 标题与可见性规则独立，不复用插件调试那套过滤。
 */

import type { IModelGateway, ModelMessage, ModelPart } from '../model/IModelGateway';
import type { ChatHistoryManager } from '../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../assistant/IMessageRenderer';
import type { ChatAttachment } from './ChatAttachment';
import { describeAttachment } from './ChatAttachment';
import { buildConversationMessages, summarizeSession } from './ConversationPrompt';
import { resourceFromFile } from './ResourceInput';
import { processImage, processPdf } from './ResourceProcessors';
import { isDebugTraceStep, visibleDebugSteps } from './PluginTraceVisibility';
import { getRole, type ChatRoleId } from './ChatRole';
import type { AgentTurnRequest } from '../plugin/PluginAgentUseCase';
import type { AgentTurnResult, PluginTraceStep } from '@domain/plugin/types';
import { runWebToolLoop, type WebTraceStep } from './WebToolLoop';
import type { WebFetchToolDeps } from './WebFetchTool';

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

/** 本地附件的宿主输入形状（只用到 File 的这三个成员，便于测试注入） */
export interface LocalFileInput {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** send() 的可选参数：用户直接附加的本地文件 */
export interface SendOptions {
  files?: LocalFileInput[];
  /** PDF 处理模式，默认 text（端侧抽文字）；用户可在 UI 选 native */
  pdfMode?: 'text' | 'native';
}

/**
 * 本地文件 → 附件 + 需要注入当前轮消息的多模态 parts。
 * 用户已经明确给了文件，不需要模型「决定」读取，因此不走 tool_calls。
 * 失败逐个变一段可见文本（不假装读过），不阻断其余附件。
 */
async function prepareLocalFiles(
  files: LocalFileInput[],
  pdfMode: 'text' | 'native',
): Promise<{ attachments: ChatAttachment[]; parts: ModelPart[]; notes: string[] }> {
  const attachments: ChatAttachment[] = [];
  const parts: ModelPart[] = [];
  const notes: string[] = [];
  for (const file of files) {
    try {
      const resource = await resourceFromFile(file);
      // 种类在统一输入里一次判定，不拿规范化后的 MIME 二次猜
      if (resource.kind === 'pdf') {
        const r = await processPdf(resource, pdfMode);
        if (r.attachment) attachments.push(r.attachment);
        if (r.parts) parts.push(...r.parts);
        if (!r.ok) notes.push(`《${file.name}》：${r.detail}`);
      } else if (resource.kind === 'image') {
        const r = processImage(resource);
        if (r.attachment) attachments.push(r.attachment);
        if (r.parts) parts.push(...r.parts);
      } else {
        notes.push(`《${file.name}》：不支持的文件类型（${file.type || '未知'}）`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notes.push(`《${file.name}》读取失败：${reason}`);
    }
  }
  return { attachments, parts, notes };
}

/** 网络智能体过程块的标题；与插件调试过程区分 */
const WEB_TRACE_TITLE = '🌐 访问过程';

export class ChatUseCase {
  constructor(
    private readonly gateway: IModelGateway,
    private readonly history: ChatHistoryManager,
    private readonly renderer: IMessageRenderer,
    /** 可选：装配后，仅 plugin 角色的消息才获得插件编程能力 */
    private readonly agent?: IPluginAgent,
    /** 当前角色由页面提供（角色绑定会话）。不传则默认闲聊。 */
    private readonly roleProvider?: () => ChatRoleId,
    /** chat 角色的网络工具依赖（proxyUrl / timeoutMs）。不传则退回纯文本单次调用 */
    private readonly webTools?: WebFetchToolDeps,
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
   * - agent loop 的 tool_calls / tool 观察只存在单次 turn 内存里，不写历史。
   */
  async send(text: string, options?: SendOptions): Promise<void> {
    if (isSlashCommand(text)) {
      await this.renderHint(SLASH_COMMAND_HINT);
      return;
    }
    if (!this.gateway.isReady()) {
      await this.renderHint(NOT_READY_HINT);
      return;
    }

    // 纯附件没有文字时补一句明确问题：不让模型对着图片猜用户要什么。
    // 放在 useCase 而不是 UI，保证任何调用方（含测试/其他宿主）口径一致。
    const hasFiles = Boolean(options?.files?.length);
    const userText = (!text.trim() && hasFiles)
      ? '请阅读我附加的文件并说明其内容。'
      : text;

    // 角色在发送这一刻确定，整条消息只走这一条路径。
    const role = getRole(this.roleProvider?.() ?? 'chat');

    // 本地附件：宿主在发送瞬间预处理，不劳模型「决定」读取。
    // 失败逐个变成可见说明，其余附件照常发送。
    const local = options?.files?.length
      ? await prepareLocalFiles(options.files, options.pdfMode ?? 'text')
      : { attachments: [] as ChatAttachment[], parts: [] as ModelPart[], notes: [] as string[] };

    // 用户气泡 + 落盘（附件作为独立字段，不进 content）
    const bubbleText = local.notes.length
      ? `${userText}\n\n[附件提示] ${local.notes.join('；')}`
      : userText;
    await this.renderer.renderMessage(bubbleText, true, null, null, undefined, undefined, false);
    for (const a of local.attachments) {
      await this.renderHint(describeAttachment(a));
    }
    await this.history.addMessage({
      role: 'user',
      content: userText,
      ...(local.attachments.length > 0 ? { attachments: local.attachments } : {}),
    });
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
    this.renderer.showTyping();

    // 两套过程块互斥：plugin 角色用「插件调试过程」（只放行代码调试步骤），
    // chat 角色用「访问过程」（只放行 decision/observe/final 的网络步骤）。
    // 懒建：只有第一个该展示的步骤到达时才创建，纯闲聊不挂空壳。
    let realtime = false;
    let started = false;
    let beginAttempted = false;
    let lastStepOk = true;
    const hasRealtimeRenderer = Boolean(
      this.renderer.beginPluginTrace && this.renderer.appendPluginTraceStep,
    );
    const showPluginTrace = useAgent && role.trace;
    const showWebTrace = !useAgent;

    const ensureStarted = (): boolean => {
      if (started || beginAttempted || !hasRealtimeRenderer) return started;
      beginAttempted = true;
      try {
        realtime = this.renderer.beginPluginTrace!(
          showPluginTrace ? undefined : WEB_TRACE_TITLE,
        ) === true;
        started = realtime;
      } catch { /* 纯展示，吞掉 */ }
      return started;
    };

    const onPluginStep = showPluginTrace && hasRealtimeRenderer
      ? (step: PluginTraceStep): void => {
          if (!isDebugTraceStep(step)) return;
          if (!ensureStarted()) return;
          try {
            this.renderer.appendPluginTraceStep!(step);
            lastStepOk = step.ok;
          } catch { /* ignore */ }
        }
      : undefined;

    const onWebStep = showWebTrace && hasRealtimeRenderer
      ? (step: WebTraceStep): void => {
          // 纯闲聊（模型直接给最终文本，没有 tool_calls）不该挂一个空的
          // 「访问过程」块：只有真的执行了工具（observe 步骤）才亮出来。
          // decision 是每轮都有的内部决策，不作为展示触发条件。
          if (step.phase !== 'observe' && !started) return;
          if (!ensureStarted()) return;
          try {
            // WebTraceStep 与 PluginTraceStep 结构一致，仅 source 不同
            this.renderer.appendPluginTraceStep!(step as unknown as PluginTraceStep);
            lastStepOk = step.ok;
          } catch { /* ignore */ }
        }
      : undefined;

    try {
      const result = useAgent
        ? await this.runAgent(text, onPluginStep)
        : undefined;
      const webResult = useAgent
        ? undefined
        : await this.runWebChat(onWebStep, local.parts);
      const reply = result ? result.reply : (webResult?.reply ?? '');

      // 工具这一轮读到的资源落进用户消息，下一轮追问能重放（决策第 6 点）。
      // 本轮 loop 内部已自行追加 parts，这里只补历史，不重复注入。
      // 用 duck typing 兼容旧实现 / 测试替身：没有该方法就跳过，不抛错。
      if (webResult?.attachments.length) {
        const append = (this.history as {
          appendAttachmentsToLastUser?: (a: ChatAttachment[]) => Promise<void>;
        }).appendAttachmentsToLastUser;
        if (typeof append === 'function') {
          await append.call(this.history, webResult.attachments);
        }
      }
      this.renderer.hideTyping();

      // 兜底：渲染器不支持实时、或 begin 返回 false → 结束后一次性全量渲染。
      const visiblePlugin = result ? visibleDebugSteps(result.trace) : [];
      // 纯闲聊不展示「访问过程」：只有真的执行过工具（存在 observe）才渲染，
      // 与实时路径的懒建条件保持一致。
      const hasWebAccess = Boolean(webResult?.trace.some((s) => s.phase === 'observe'));
      const visibleWeb: PluginTraceStep[] = hasWebAccess && webResult ? webResult.trace : [];
      if (!realtime && this.renderer.renderPluginTrace) {
        if (showPluginTrace && visiblePlugin.length > 0) {
          try { await this.renderer.renderPluginTrace(visiblePlugin); } catch { /* ignore */ }
        } else if (showWebTrace && visibleWeb.length > 0) {
          try { await this.renderer.renderPluginTrace(visibleWeb, WEB_TRACE_TITLE); } catch { /* ignore */ }
        }
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
      // 历史里只有干净的 user/assistant 文本，trace 与 tool 消息永远不进来
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

  /**
   * chat 角色：标准 tool-calling agent loop。
   * buildConversationMessages 已完成上下文裁剪；loop 内部追加的 tool_calls /
   * tool 观察只在内存里，不落会话历史。
   */
  private async runWebChat(
    onTrace?: (step: WebTraceStep) => void,
    localParts: ModelPart[] = [],
  ): Promise<{ reply: string; trace: WebTraceStep[]; attachments: ChatAttachment[] }> {
    const messages: ModelMessage[] = buildConversationMessages(this.history.getMessages());
    // 本地附件的多模态 parts 注入「当前句」：历史构造已把用户消息放在最后，
    // 这里把它从 string 提升为 part 数组，追加图片 / 原生 PDF。
    if (localParts.length > 0) {
      const last = messages[messages.length - 1];
      if (last && last.role === 'user') {
        const head: ModelPart[] = typeof last.content === 'string'
          ? [{ type: 'text', text: last.content }]
          : last.content;
        last.content = [...head, ...localParts];
      }
    }
    // 未装配工具依赖时退回单次纯文本调用（例如某些精简装配场景）
    if (!this.webTools) {
      const result = await this.gateway.execute({
        task: 'chat.reply',
        messages,
        options: { jsonMode: false },
      });
      return { reply: result.text, trace: [], attachments: [] };
    }
    const result = await runWebToolLoop(
      { gateway: this.gateway, toolDeps: this.webTools },
      { messages, ...(onTrace ? { onTrace } : {}) },
    );
    return { reply: result.reply, trace: result.trace, attachments: result.attachments };
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
