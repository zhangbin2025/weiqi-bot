/**
 * 对话用例
 * @module application/chat/ChatUseCase
 *
 * 职责：处理一条用户消息 —— 渲染、写历史、拼上下文、调模型网关、渲染回复。
 *
 * 分流依据不是「猜这句话属于哪个意图」，而是用户显式选定的模型角色（ChatRole）。
 * 两个角色共用**同一个**标准 tool-calling agent loop（ToolLoop.ts）：
 * - chat 角色：挂网页 / PDF / 图片工具，system 用 CONVERSATION_SYSTEM_PROMPT，source='web'。
 * - plugin 角色：挂插件开发工具集（列/查/写/试算/启停/删除/应用/回滚），
 *   system 由工具集动态生成（实时插件清单 + 沙箱契约），source='plugin'。
 *
 * 角色只决定「挂哪套 tools + 注入哪段 system + 过程块标题」，不再有两套循环、
 * 不再有自造 JSON 动作协议，也不再有「调试步骤白名单」。新增能力 = 往工具集登记，
 * 本用例一行不改。角色由页面注入，用例本身不持久化、不猜测。
 *
 * 安全边界（沿用，不能因为合并分流而绕过）：
 * - 「/」开头只渲染提示，不写历史（避免 apiKey 明文落盘）。
 * - 模型失败只渲染错误、不写进历史；用户消息仍保留。
 * - 所有回复无条件经 safeReply 转义（渲染器用 marked/innerHTML，这是唯一防线）。
 * - loop 内部的 tool_calls / tool 观察只存在单次 turn 内存里，不写历史。
 * - 过程块懒建：纯闲聊、plugin 角色纯问答（无工具调用）都不挂空壳。
 */

import type { IModelGateway, ModelMessage, ModelPart } from '../model/IModelGateway';
import type { ChatHistoryManager } from '../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../assistant/IMessageRenderer';
import type { ChatAttachment } from './ChatAttachment';
import { describeAttachment } from './ChatAttachment';
import { buildConversationMessages, summarizeSession } from './ConversationPrompt';
import { resourceFromFile } from './ResourceInput';
import { processImage, processPdf } from './ResourceProcessors';
import { getRole, type ChatRoleId } from './ChatRole';
import type { PluginTraceStep } from '@domain/plugin/types';
import { runToolLoop, type ToolKit, type ToolLoopResult } from './ToolLoop';
import { createWebToolKit } from './WebToolLoop';
import type { WebFetchToolDeps } from './WebFetchTool';
import { safeReply } from './safeReply';

/** 拦截「/」开头：chat 页零命令体系，配置请回功能助手 */
export const SLASH_COMMAND_HINT = '对话页不支持命令，模型配置请回到功能助手操作。';
export const NOT_READY_HINT = '尚未配置 LLM，请回到功能助手执行 /llm 配置后再来对话。';

/** 选了插件角色但插件系统装配失败时的提示（页面始终可用，不抛错） */
export const AGENT_UNAVAILABLE_HINT =
  '插件系统未能加载，当前无法使用「插件开发」角色。请刷新重试，或切回「闲聊」角色继续对话。';

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

/** 过程块标题：两个角色各一个，展示层按 source 再区分步骤标签 */
const WEB_TRACE_TITLE = '🌐 访问过程';
const PLUGIN_TRACE_TITLE = '🔧 插件开发过程';

export class ChatUseCase {
  constructor(
    private readonly gateway: IModelGateway,
    private readonly history: ChatHistoryManager,
    private readonly renderer: IMessageRenderer,
    /** 装配后 plugin 角色才有的插件工具集；不传则 plugin 角色给明确提示 */
    private readonly pluginToolKit?: ToolKit,
    /** 当前角色由页面提供（角色绑定会话）。不传则默认闲聊。 */
    private readonly roleProvider?: () => ChatRoleId,
    /** chat 角色的网络工具依赖（proxyUrl / timeoutMs）。不传则退回纯文本单次调用 */
    private readonly webTools?: WebFetchToolDeps,
  ) {}

  isReady(): boolean {
    return this.gateway.isReady();
  }

  /** 发送一条用户消息 */
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
    const hasFiles = Boolean(options?.files?.length);
    const userText = (!text.trim() && hasFiles)
      ? '请阅读我附加的文件并说明其内容。'
      : text;

    // 角色在发送这一刻确定，整条消息只走这一条路径。
    const role = getRole(this.roleProvider?.() ?? 'chat');
    const usePlugin = role.agent;

    // 本地附件：宿主在发送瞬间预处理，不劳模型「决定」读取。
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
    // 首条消息生成会话摘要/标题
    if (this.history.getMessages().filter((m) => m.role === 'user').length === 1) {
      await this.history.setCurrentSessionTitle(summarizeSession(this.history.getMessages()));
    }

    // 选了插件角色但插件系统没装上：给明确提示，不静默降级成闲聊
    if (usePlugin && !this.pluginToolKit) {
      this.renderer.hideTyping();
      await this.renderHint(AGENT_UNAVAILABLE_HINT);
      return;
    }

    // 统一过程块：懒建（只有真的执行了工具、出现 observe 步骤才点亮）。
    // 纯闲聊、plugin 角色纯问答都不会挂空壳。
    const traceTitle = usePlugin ? PLUGIN_TRACE_TITLE : WEB_TRACE_TITLE;
    let realtime = false;
    let started = false;
    let beginAttempted = false;
    let lastStepOk = true;
    const hasRealtimeRenderer = Boolean(
      this.renderer.beginPluginTrace && this.renderer.appendPluginTraceStep,
    );

    const ensureStarted = (): boolean => {
      if (started || beginAttempted || !hasRealtimeRenderer) return started;
      beginAttempted = true;
      try {
        realtime = this.renderer.beginPluginTrace!(traceTitle) === true;
        started = realtime;
      } catch { /* 纯展示，吞掉 */ }
      return started;
    };

    const onTrace = hasRealtimeRenderer
      ? (step: PluginTraceStep): void => {
          if (step.phase !== 'observe' && !started) return;
          if (!ensureStarted()) return;
          try {
            this.renderer.appendPluginTraceStep!(step);
            lastStepOk = step.ok;
          } catch { /* ignore */ }
        }
      : undefined;

    this.renderer.showTyping();
    try {
      const result = await this.runTurn(usePlugin, local.parts, onTrace);

      // 工具这一轮读到的资源落进用户消息，下一轮追问能重放。
      // 用 duck typing 兼容旧实现 / 测试替身：没有该方法就跳过，不抛错。
      if (result.attachments.length) {
        const append = (this.history as {
          appendAttachmentsToLastUser?: (a: ChatAttachment[]) => Promise<void>;
        }).appendAttachmentsToLastUser;
        if (typeof append === 'function') {
          await append.call(this.history, result.attachments);
        }
      }
      this.renderer.hideTyping();

      // 兜底：渲染器不支持实时、或 begin 返回 false → 结束后一次性全量渲染。
      // 与懒建一致：只有真的执行过工具（存在 observe）才渲染。
      const hasObserved = result.trace.some((s) => s.phase === 'observe');
      if (!realtime && hasObserved && this.renderer.renderPluginTrace) {
        try { await this.renderer.renderPluginTrace(result.trace, traceTitle); } catch { /* ignore */ }
      }

      // 安全边界：所有回复无条件转义+截断（旧实现只在装了插件系统时转义，
      // 那个缺口在这里堵上）。
      const safe = safeReply(result.reply);
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
   * 按角色选一套工具集，跑同一个 runToolLoop。
   * buildConversationMessages 已完成上下文裁剪；loop 内部追加的 tool_calls /
   * tool 观察只在内存里，不落会话历史。
   */
  private async runTurn(
    usePlugin: boolean,
    localParts: ModelPart[],
    onTrace?: (step: PluginTraceStep) => void,
  ): Promise<ToolLoopResult> {
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

    // chat 角色没装网络工具依赖时退回单次纯文本调用（精简装配场景）。
    // 保留 options.jsonMode=false，与既有配置口径一致。
    if (!usePlugin && !this.webTools) {
      const result = await this.gateway.execute({
        task: 'chat.reply',
        messages,
        options: { jsonMode: false },
      });
      return {
        reply: result.text, trace: [], attachments: [], turns: 1, exhausted: false,
      };
    }

    const kit: ToolKit = usePlugin
      ? this.pluginToolKit!
      : createWebToolKit(this.webTools!);
    const source: PluginTraceStep['source'] = usePlugin ? 'plugin' : 'web';

    return runToolLoop(
      {
        gateway: this.gateway,
        tools: kit.tools,
        executors: kit.executors,
        // 只有插件工具集带动态 system；chat 沿用 messages[0] 的 CONVERSATION_SYSTEM_PROMPT
        ...(kit.systemPrompt ? { systemPrompt: kit.systemPrompt } : {}),
        ...(kit.maxTurns !== undefined ? { maxTurns: kit.maxTurns } : {}),
        source,
      },
      {
        messages,
        ...(onTrace ? { onTrace } : {}),
      },
    );
  }

  /** 提示类消息：只渲染，绝不写历史 */
  private async renderHint(text: string): Promise<void> {
    await this.renderer.renderMessage(
      text, false, null, null, undefined, undefined, false,
    );
  }
}
