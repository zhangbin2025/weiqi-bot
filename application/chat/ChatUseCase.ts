/**
 * 对话用例
 * @module application/chat/ChatUseCase
 *
 * 职责：处理一条用户消息 —— 渲染、写历史、拼上下文、调模型网关、渲染回复。
 *
 * 分流依据不是「猜这句话属于哪个意图」，而是用户显式选定的模型角色（ChatRole）。
 * 两个角色共用**同一个**标准 tool-calling agent loop（ToolLoop.ts）：
 * - chat 角色：挂网页 / PDF / 图片工具，system 用 CONVERSATION_SYSTEM_PROMPT，source='web'；
 *   命中声明 requiredCapabilities 的技能时才追加 llm_tool_call 工具与动态能力库清单。
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

import type { IModelGateway, ModelMessage, ModelPart, ModelToolDefinition } from '../model/IModelGateway';
import type { ChatHistoryManager } from '../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../assistant/IMessageRenderer';
import type { ChatAttachment } from './ChatAttachment';
import { describeAttachment } from './ChatAttachment';
import {
  buildConversationMessages, buildOverflowFallbackMessages,
  CONVERSATION_SYSTEM_PROMPT, CONTEXT_LIMITS,
} from './ConversationPrompt';
import type { ConversationSummary } from './ConversationPrompt';
import type { ConversationCompactor } from './ConversationCompactor';
import { clampTitle, generateSessionTitle } from './SessionTitle';
import { resourceFromFile } from './ResourceInput';
import { processImage, processPdf } from './ResourceProcessors';
import { getRole, type ChatRoleId } from './ChatRole';
import type { PluginTraceStep } from '@domain/plugin/types';
import { runToolLoop, type ToolKit, type ToolLoopResult, type ToolExecutor, type ToolOutcome } from './ToolLoop';
import { createWebToolKit } from './WebToolLoop';
import type { WebFetchToolDeps } from './WebFetchTool';
import { safeReply } from './safeReply';
import type { createLlmToolKit } from '../plugin/LlmToolKit';
import type { SkillPrimitive, SkillRecipe } from '../skill/SkillTypes';
import type { SkillDevKit } from '../skill/dev/SkillDevTools';
import { selectSkills } from '../skill/SkillSelector';
import { routeSkills, type SkillRouteInput } from '../skill/SkillRouter';
import { buildSkillToolParts } from '../skill/SkillRegistry';
import { buildSkillSystemPrompt } from '../skill/SkillSystemPrompt';
import { beginUserTurn } from '../skill/SkillTurn';
import type { KvKit } from '../skill/kv/KvKit';

/** 拦截「/」开头：chat 页零命令体系，配置请回功能助手 */
export const SLASH_COMMAND_HINT = '对话页不支持命令，模型配置请回到功能助手操作。';
export const NOT_READY_HINT = '尚未配置 LLM，请回到功能助手执行 /llm 配置后再来对话。';

/** 选了插件角色但插件系统装配失败时的提示（页面始终可用，不抛错） */
export const AGENT_UNAVAILABLE_HINT =
  '插件系统未能加载，当前无法使用「插件开发」角色。请刷新重试，或切回「闲聊」角色继续对话。';

export function isSlashCommand(text: string): boolean {
  return text.trim().startsWith('/');
}

/**
 * 在线技能配方的可选装配（ChatUseCase 第 7 个构造参数）。
 *
 * 安全边界：在线资源只有 JSON 描述，primitives 是宿主内置且固定的执行器注册表。
 * 在线配方只能引用注册表里已有的原语名，永远不携带可执行代码；缺原语的配方
 * 由 selectSkills 整条跳过（在线允许领先宿主版本）。
 */
export interface SkillDeps {
  /** 每条用户消息调用一次，返回内置 + 在线 + 本地自建合并后的配方清单；失败应自行回落内置 */
  loadSkills(): Promise<SkillRecipe[]>;
  /**
   * 可选：技能路由。缺省时由宿主用当前 gateway 做一次轻量 LLM 路由
   * （见 SkillRouter.routeSkills）；注入桩主要用于测试或特殊装配，不改路由契约。
   * 返回本轮要激活的技能 id，宿主仍会用 selectSkills 过原语 / 能力库硬门槛。
   */
  routeSkills?: (
    recipes: readonly SkillRecipe[],
    input: SkillRouteInput,
  ) => Promise<string[]>;
  /** 宿主原语注册表：name → 声明 + 执行器 */
  primitives: ReadonlyMap<string, SkillPrimitive>;
  /**
   * 可选：技能开发角色的增量工具集（skill_list / skill_write + 开发 system 片段）。
   * 只有当前角色是 skill-dev 时才挂；闲聊角色完全不接触（零额外 token）。
   */
  devKit?: SkillDevKit;
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

/** 上下文里是否还带着图片 / 原生 PDF 附件（重放的历史附件也算） */
function hasImagePart(messages: readonly ModelMessage[]): boolean {
  return messages.some((m) => {
    const c = m.content;
    return Array.isArray(c) && c.some((p) => p.type === 'image' || p.type === 'file');
  });
}

/** 过程块标题：两个角色各一个，展示层按 source 再区分步骤标签 */
const WEB_TRACE_TITLE = '🌐 访问过程';
const PLUGIN_TRACE_TITLE = '🔧 插件开发过程';

export class ChatUseCase {
  /** 上一轮激活的技能 id：供「好的 / 确认」这类承接语的路由信号，纯内存不落盘 */
  private previousSkillIds: string[] = [];

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
    /** 可选：在线技能配方（仅 chat 角色生效）。不传则行为与旧版完全一致。 */
    private readonly skills?: SkillDeps,
    /**
     * 可选：模型能力插件工具集。不传则完全不挂；传入时也只在本轮命中的技能
     * 声明了 requiredCapabilities 时才挂 llm_tool_call + 能力库清单，
     * 不因「装过农历库」就把无关工具塞进每一轮（如 GitHub 请求）。
     */
    private readonly llmToolKit?: ReturnType<typeof createLlmToolKit>,
    /**
     * 可选：Skill 本地数据层（kv_* 原语 + system 说明）。chat / skill-dev 角色恒定挂载，
     * 不传则完全不挂，既有测试与精简装配逐字沿用旧行为。plugin 开发角色不接触。
     */
    private readonly kvKit?: KvKit,
    /**
     * 可选：会话上下文压缩器（宿主内部行为）。不传则逐字沿用旧窗口裁剪，
     * 既有测试与精简装配零变化；传入时在每轮构造上下文前同步 compact。
     */
    private readonly compactor?: ConversationCompactor,
  ) {}

  isReady(): boolean {
    return this.gateway.isReady();
  }

  /**
   * 用模型精炼当前会话标题（页面在首轮发送后旁路调用）。
   *
   * 这是异步旁路：await 模型期间用户可能新建/打开别的会话，因此调用方把
   * 发起时的 sessionId 传进来，写回前必须复核当前会话仍是它 —— 否则丢弃结果，
   * 绝不把 A 会话的标题写到 B 会话上。任何失败都静默降级：send() 已先写入
   * 短兜底标题，标题栏永远有值。
   *
   * @returns 精炼后的短标题；无需精炼 / 失败 / 会话已切换时返回 null
   */
  async refineSessionTitle(userText: string, sessionId: string): Promise<string | null> {
    const refined = await generateSessionTitle(this.gateway, userText);
    if (!refined) return null;
    if (this.history.getCurrentSession()?.sessionId !== sessionId) return null;
    await this.history.setCurrentSessionTitle(refined);
    return refined;
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

    // 每条用户消息推进一次「人工确认闸门」序号：赛事导入的 commit 只接受
    // 预览之后的新一条消息，杜绝模型在同一轮里自问自答把数据写进库。
    beginUserTurn();

    // 纯附件没有文字时补一句明确问题：不让模型对着图片猜用户要什么。
    const hasFiles = Boolean(options?.files?.length);
    const userText = (!text.trim() && hasFiles)
      ? '请阅读我附加的文件并说明其内容。'
      : text;

    // 角色在发送这一刻确定，整条消息只走这一条路径。
    // skill-dev 是闲聊超集：usePlugin=false，但多挂一套开发工具与开发 system。
    const role = getRole(this.roleProvider?.() ?? 'chat');
    const usePlugin = role.agent;
    const devMode = role.skillDev;

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
    // 首条消息先落一个即时可用的短兜底标题（0 网络请求、不打断对话）。
    // 模型精炼由页面拿到 gateway 后旁路执行，覆盖这里的值。
    if (this.history.getMessages().filter((m) => m.role === 'user').length === 1) {
      await this.history.setCurrentSessionTitle(clampTitle(userText));
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
    // 过程块成败按「任一步失败」累计，而不是最后一步的 ok：
    // 工具失败后通常还会追加一条成功的 final 步，用最后一步会把失败状态洗掉。
    // 与 AssistantRenderer.renderPluginTrace 的 failed === 0 口径保持一致。
    let traceFailed = false;
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
            if (!step.ok) traceFailed = true;
          } catch { /* ignore */ }
        }
      : undefined;

    this.renderer.showTyping();
    try {
      // 同步 compact（用户 2026-11-19 决策①）：本轮就摘要、落 checkpoint、
      // 把摘要注入本轮上下文，不做 fire-and-forget。失败由 compactor 静默降级。
      const sessionId = this.history.getCurrentSession()?.sessionId ?? '';
      const checkpoint = this.compactor && sessionId
        ? await this.compactor.maybeCompact(this.history.getMessages(), sessionId)
        : null;
      const summary: ConversationSummary | undefined = checkpoint
        ? { seq: checkpoint.seq, summary: checkpoint.summary, firstKeptIndex: checkpoint.firstKeptIndex }
        : undefined;
      let result: ToolLoopResult;
      try {
        result = await this.runTurn(usePlugin, devMode, local.parts, onTrace, summary);
      } catch (error) {
        // 溢出恢复：同一 turn 只重试一次（封顶 1 次），且只在 compactor 认出是
        // 上下文溢出时触发。重试把窗口收到最小（主 system + 摘要 + 当前句），
        // 不改任何 CONTEXT_LIMITS 常量；其它错误照旧走下面的失败提示。
        const isOverflow = this.compactor?.isOverflowError(error) === true;
        if (!isOverflow) throw error;
        result = await this.runTurn(usePlugin, devMode, local.parts, onTrace, summary, true);
      }

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
      // 宿主注入链接：不经过模型回复文本，直接走渲染器的 actionUrl 通道。
      // 这样历史里没有任何链接文本可供下一轮模型「照抄改字」，从根上消除
      // 「第一次对、第二次换条件就错」的多轮退化。
      const link = result.actionLink;
      // 宿主结构化展示块（新闻表格等）：数据旁路，走独立渲染参数，绝不塞进回复文本。
      // 只在真的有展示块时才补第 11 参；普通回复逐字保持旧版 7 参调用形状，
      // 既有 toHaveBeenLastCalledWith 断言与无技能装配路径零变化。
      const display = result.displayMarkdown;
      if (display) {
        await this.renderer.renderMessage(
          safe, false, null, null,
          link?.url, link?.label,
          true, undefined, undefined, undefined, display,
        );
      } else {
        await this.renderer.renderMessage(
          safe, false, null, null,
          link?.url, link?.label,
          true,
        );
      }
      // 历史里只有干净的 user/assistant 文本 + 结构化字段，trace 与 tool 消息永远不进来；
      // 展示块与 content 分栏，刷新后可回放，但 buildConversationMessages 不会读它。
      await this.history.addMessage({
        role: 'assistant', content: safe,
        ...(link ? { actionUrl: link.url, actionText: link.label } : {}),
        ...(display ? { displayMarkdown: display } : {}),
      });
    } catch (error) {
      this.renderer.hideTyping();
      traceFailed = true;
      const message = error instanceof Error ? error.message : String(error);
      await this.renderHint(`❌ 对话失败：${message}`);
    } finally {
      // 实时块统一收尾：标题定稿、折叠回去；异常路径也不会一直挂「进行中…」
      if (realtime && started && this.renderer.finishPluginTrace) {
        try { this.renderer.finishPluginTrace(!traceFailed); } catch { /* ignore */ }
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
    devMode: boolean,
    localParts: ModelPart[],
    onTrace?: (step: PluginTraceStep) => void,
    summary?: ConversationSummary,
    overflowFallback = false,
  ): Promise<ToolLoopResult> {
    const history = this.history.getMessages();
    const build = overflowFallback ? buildOverflowFallbackMessages : buildConversationMessages;
    const messages: ModelMessage[] = build(history, summary);
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
      // 纯文本降级分支：错误本来就冒泡到 send() 的失败提示 / 溢出重试逻辑，
      // 不需要 ToolLoop 那层 rethrow 开关。
      const result = await this.gateway.execute({
        task: 'chat.reply',
        messages,
        options: { jsonMode: false },
      });
      return {
        reply: result.text, trace: [], attachments: [], turns: 1, exhausted: false,
      };
    }

    // chat 角色：基础 web 工具恒定挂载；装了技能系统时，先由 LLM 路由理解本轮意图
    // 给出技能 id，再经 selectSkills 硬门槛筛出可用配方，只把原语追加进 tools[]。
    // 路由失败 / 无需技能时返回空激活，正常对话继续，零额外工具。
    // chat 角色：技能系统与 llm-tool 能力库只要装了任一个，就走拼装路径。
    // 两者都没装才逐字返回基础 web kit（保持旧行为、零额外 token）。
    const kit: ToolKit = usePlugin
      ? this.pluginToolKit!
      : (this.skills || this.llmToolKit || this.kvKit)
        ? await this.buildChatToolKit(messages, localParts.length > 0, devMode)
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
        // 只在装了 compactor 且不是溢出重试那一轮时挂：让上下文超限错误冒泡，
        // 供 send() 缩小上下文重试一次；其它所有错误仍由 ToolLoop 转成失败回复。
        ...(this.compactor && !overflowFallback
          ? { rethrow: (e: unknown) => this.compactor!.isOverflowError(e) }
          : {}),
        source,
      },
      {
        messages,
        ...(onTrace ? { onTrace } : {}),
      },
    );
  }

  /**
   * 拼装 chat / skill-dev 角色本轮的工具集：
   * - 基础 web 工具（3 个）恒定挂载，行为与旧版一致；
   * - llm-tool 只在本轮命中的技能声明了 requiredCapabilities 时才追加，
   *   与 SkillSelector 的激活前硬检查同源；无关技能（如 github.rest）不会被挂上农历库；
   * - 命中技能引用的原语按 name 去重后追加（基础工具优先，避免同名执行器被覆盖）；
   * - system 由 buildSkillSystemPrompt 在 CONVERSATION_SYSTEM_PROMPT 之上补本轮技能说明；
   *   闲聊无命中时原样返回基础 kit（无 systemPrompt，模型上下文与旧版逐字相同）。
   * - skill-dev 是闲聊超集：在上面之上再追加 skill_list / skill_write 与一段开发说明，
   *   并始终返回拼接后的完整 system（ToolLoop 的 systemPrompt 是替换制）。
   *
   * 在线清单取用失败不阻塞对话：loadSkills 内部已回落内置，外层再兜一次异常。
   */
  private async buildChatToolKit(
    messages: ModelMessage[],
    hasNewParts: boolean,
    devMode: boolean,
  ): Promise<ToolKit> {
    let base = createWebToolKit(this.webTools!);
    // 本地数据层：chat 超集，基础 web 工具之上恒定追加（与 llm-tool 同一套去重口径）。
    // kv_* 是通用能力，不依赖技能命中；技能配方也可在 primitives 里引用同名原语。
    const kv = this.kvKit;
    if (kv) {
      const tools = [...base.tools];
      const executors: Record<string, ToolExecutor> = { ...base.executors };
      for (const p of kv.primitives) {
        if (!executors[p.name]) {
          tools.push(p.definition);
          executors[p.name] = async (argsJson: string) => {
            const r = await p.execute(argsJson);
            const out: ToolOutcome = { observation: r.observation, ok: r.ok, detail: r.detail };
            if (r.actionLink) out.actionLink = r.actionLink;
            if (r.displayMarkdown) out.displayMarkdown = r.displayMarkdown;
            if (r.preparatory) out.preparatory = true;
            return out;
          };
        }
      }
      base = { ...base, tools, executors };
    }
    // llm-tool 是否挂载要看本轮命中的技能声明（见下方 needsLlm），这里先取引用：
    // capabilities 的激活前硬检查无论挂不挂工具都要用，故独立调用 listCapabilities()。
    const llm = this.llmToolKit;
    let recipes: readonly SkillRecipe[] = [];
    try {
      recipes = this.skills ? await this.skills.loadSkills() : [];
    } catch {
      recipes = [];
    }
    // 图片导入是「预览 → 用户确认 → 写库」两阶段：确认那一轮没有新附件，
    // 但历史里的图片附件仍随上下文重放。用它保持导入技能挂载，直到图片滑出
    // 20 条消息窗口（沿用既有 maxMessages，不另设过期时间/阈值）。
    const contextHasImage = hasNewParts || hasImagePart(messages);
    // LLM 技能路由：目录只用 id / name / summary；输入是最近的用户消息（沿用
    // 既有 maxMessages 窗口）+ 宿主给出的结构化上下文信号。失败 → 空激活，
    // 不回落关键词、不重试、不打断对话。
    const recentUserTexts = messages
      .filter((m) => m.role === 'user')
      .slice(-CONTEXT_LIMITS.maxMessages)
      .map((m) => (typeof m.content === 'string'
        ? m.content
        : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')));
    const routeInput = {
      recentUserTexts,
      hasAttachments: contextHasImage,
      previousSkillIds: this.previousSkillIds,
    };
    let routedIds: string[] = [];
    // 没有已启用配方就没有可路由的目录：空集短路，不发这次模型调用。
    // 这不是「省一次调用维护词表」，而是没有候选集时的自然行为。
    if (recipes.length > 0) {
      try {
        routedIds = this.skills?.routeSkills
          ? await this.skills.routeSkills(recipes, routeInput)
          : (await routeSkills(this.gateway, recipes, routeInput)).skillIds;
        // 默认路由的 reason 供未来可观测性使用，当前静默降级不消费。
      } catch { routedIds = []; }
    }
    // requiredCapabilities 的激活前硬检查：取当前已启用能力库暴露的方法名并集。
    // 与 buildSystemSuffix 共用 listActive() 同一份工件存储读取，不另建清单；
    // 装配失败 / 未注入 llm-tool 时按空集处理，有依赖的技能一律不激活。
    let capabilities: string[] = [];
    if (llm) {
      try { capabilities = await llm.listCapabilities(); } catch { capabilities = []; }
    }
    const active = this.skills
      ? selectSkills(
        routedIds, contextHasImage, recipes, this.skills.primitives, capabilities,
      )
      : [];
    // 下一轮的承接语靠这个信号续上；本轮没激活就清空，避免技能粘连。
    // 路由失败完全静默：不写模型上下文 / 会话历史 / 过程块，正常对话继续，
    // 避免一次旁路调用失败打断用户。
    this.previousSkillIds = active.map((s) => s.id);
    const dev = devMode ? this.skills?.devKit : undefined;

    // llm-tool 按需挂载：只有本轮命中的技能真的声明了 requiredCapabilities 才挂。
    // 声明是「我需要能力库」的唯一契约来源（与 SkillSelector / SkillCatalogService 同源）：
    // github.rest / 天气 / 股价等配方缺省该字段 = 不依赖，模型本轮看不到 llm_tool_call、
    // 也看不到农历能力库清单，不会白起一次 QuickJS 沙箱；月历配方声明
    // ['monthCalendar'] 才把工具与清单挂上。装过某个库 ≠ 每轮都要把它塞给模型。
    const needsLlm = active.some(
      (s) => s.requiredCapabilities !== undefined && s.requiredCapabilities.length > 0,
    );
    if (llm && needsLlm) {
      const tools = [...base.tools];
      const executors: Record<string, ToolExecutor> = { ...base.executors };
      for (const t of llm.tools) {
        if (llm.executors[t.name] && !executors[t.name]) {
          tools.push(t);
          executors[t.name] = llm.executors[t.name]!;
        }
      }
      base = { ...base, tools, executors };
    }

    // 闲聊且无命中、也没有 llm-tool 依赖：逐字返回基础 kit（零额外 token、无 system 覆盖）。
    let llmSuffix = '';
    if (llm && needsLlm) {
      try { llmSuffix = await llm.buildSystemSuffix(); } catch { llmSuffix = ''; }
    }
    // 挂了 kv 就必须走拼装路径，让它的 system 说明进入本轮（ToolLoop 是替换制）。
    const kvSuffix = kv?.systemSuffix ?? '';
    if (active.length === 0 && !dev && !llmSuffix && !kvSuffix) return base;

    const parts = this.skills
      ? buildSkillToolParts(active, this.skills.primitives)
      : { tools: [] as ModelToolDefinition[], executors: {} as Record<string, ToolExecutor> };
    const tools = [...base.tools];
    const executors: Record<string, ToolExecutor> = { ...base.executors };
    const appendTool = (t: ModelToolDefinition, exec: ToolExecutor | undefined): void => {
      if (exec && !executors[t.name]) {
        tools.push(t);
        executors[t.name] = exec;
      }
    };
    for (const t of parts.tools) appendTool(t, parts.executors[t.name]);

    // 基础 system：闲聊 system + 本轮命中技能说明（active 为空时就是闲聊 system 本身）
    let systemPrompt = buildSkillSystemPrompt(CONVERSATION_SYSTEM_PROMPT, active);
    if (dev) {
      for (const t of dev.tools) appendTool(t, dev.executors[t.name]);
      systemPrompt = `${systemPrompt}\n\n${dev.systemSuffix}`;
    }
    // llm-tool 的能力库清单是动态片段（每次请求读工件存储，启用/停用即时生效）。
    // ToolLoop.systemPrompt 是替换制，因此必须追加到已拼好的完整 system 尾部，
    // 不能单独返回片段，否则会冲掉闲聊 / 技能 / 技能开发说明。
    if (llmSuffix) systemPrompt = `${systemPrompt}\n\n${llmSuffix}`;
    // 本地数据层的域清单与边界说明追加到完整 system 尾部，不冲掉技能 / 开发 / 能力库片段。
    if (kvSuffix) systemPrompt = `${systemPrompt}\n\n${kvSuffix}`;
    return { tools, executors, systemPrompt };
  }

  /** 提示类消息：只渲染，绝不写历史 */
  private async renderHint(text: string): Promise<void> {
    await this.renderer.renderMessage(
      text, false, null, null, undefined, undefined, false,
    );
  }
}
