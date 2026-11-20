/**
 * AI 对话页面编排
 * @module presentation/adapters/web/pages/assistant/ChatPage
 *
 * 独立页面 assistant/chat.html 的控制器：
 * 复用功能助手的渲染器、会话存储、凭据与共享 CSS，不引入旧意图/命令体系。
 *
 * 页面由「模型角色」驱动（见 ChatRole）：默认闲聊，可切到插件开发 / 技能开发。
 * 三个角色共用同一个标准 tool-calling agent loop：闲聊挂网页/PDF/图片工具，
 * 插件角色挂插件工具集，技能开发是闲聊超集（额外挂 skill_list / skill_write）。
 * 角色只决定挂哪套工具与 system，不再按每句话猜意图，也没有两套循环。
 *
 * 角色固化在会话数据里（ChatSessionData.role），历史会话列表显示角色标识，
 * 打开历史会话会恢复它自己的角色。**已有聊天记录的会话角色锁定，不能切换**
 * —— 中途换角色会让同一段历史被两套知识体系解释，上下文会乱套。
 * 插件数据来自独立工件存储，不来自会话历史 —— 新会话、老会话、会话清空后
 * LLM 都能看到并修改插件。装配失败时降级为「闲聊可用、插件角色给提示」。
 *
 * 右上角菜单六项：新建会话 / 历史会话 / 导出会话 / 清空会话 / 插件 / 技能。
 * 「插件」是人工确认闸门：查看完整源码、复制、启停、删除都由用户显式操作。
 * 「技能」是安装制：在线源只浏览/安装，装进本地库（与自建技能一起列在「我的技能」）
 * 才会被 LLM 调用；可启停/删除/更新/配置技能源。
 */

import { AssistantRenderer } from './AssistantRenderer';
import { ChatHistoryManager, type ChatMessage, type ChatSession } from '../../../../../application/assistant/ChatHistoryManager';
import { FavoriteService } from '../../../../../services/favorite/FavoriteService';
import { IndexedDBAdapter } from '../../../../../infrastructure/storage/adapters/web/IndexedDBAdapter';
import { WebFileExporter } from '../../../../../infrastructure/utils/export/WebFileExporter';
import { WebDialog } from '../../components/Dialog';
import { ChatUseCase, type LocalFileInput, type SkillDeps } from '../../../../../application/chat/ChatUseCase';
import { createSkillRegistry } from '../../../../../application/skill/SkillRegistry';
import type { SkillPrimitive, SkillRecipe } from '../../../../../application/skill/SkillTypes';
import { createBasicPrimitives } from '../../../../../application/skill/primitives/BasicPrimitives';
import { loadWebProxyOverride } from '../../../../../infrastructure/config/WebProxyOverride';
import { createKvKit } from '../../../../../application/skill/kv/KvKit';
import { ConversationCompactor } from '../../../../../application/chat/ConversationCompactor';
import type { KvKit } from '../../../../../application/skill/kv/KvKit';
import { collectSecretSpecs } from '../../../../../application/skill/SecretSpec';
import {
  createAuthFetchPrimitives, createSecretSpecRegistry,
  SECRET_PROMPT_SCHEME,
} from '../../../../../application/skill/primitives/AuthFetchPrimitives';
import { openSecretPromptDialog } from './SecretPromptDialog';
import {
  PREF_ADD_SCHEME, PREF_ADD_WATCH_SCHEME,
  parsePrefAddHref, prefAddUserMessage, parseWatchAddCode, watchAddUserMessage,
} from './PrefLink';
import { EVENT_PRIMITIVES } from '../../../../../application/skill/primitives/EventImportPrimitives';
import { UserSkillStore, type UserSkillEntry } from '../../../../../application/skill/dev/UserSkillStore';
import { createSkillDevKit } from '../../../../../application/skill/dev/SkillDevTools';
import { openEventTableDialog } from './EventTableDialog';
import {
  createDefaultSkillCatalog, type SkillCatalogService,
  type SkillCatalogBrowseResult, type SkillBrowseItem,
} from '../../../../../services/skill-catalog/SkillCatalogService';
import { SkillCatalogSources, type SkillSource } from '../../../../../services/skill-catalog/SkillCatalogSources';
import { clampTitle } from '../../../../../application/chat/SessionTitle';
import { describeAttachment } from '../../../../../application/chat/ChatAttachment';
import { OpenAIModelGateway } from '../../../../../infrastructure/llm/OpenAIModelGateway';
import { loadLLMConfig, DEFAULT_LLM_TIMEOUT_MS } from '../../../../../infrastructure/llm/LLMCredentialStore';
import { createPluginSystem, type PluginSystem } from '../../../../../application/plugin/PluginSystem';
import type { PluginArtifact } from '../../../../../domain/plugin/types';
import { PluginCatalogService } from '../../../../../services/plugin-catalog/PluginCatalogService';
import type {
  CatalogBrowseResult, CatalogEntry, CatalogSource,
} from '../../../../../services/plugin-catalog/PluginCatalogTypes';
import {
  CHAT_ROLES, DEFAULT_ROLE_ID, ROLE_STORAGE_KEY,
  getRole, parseRoleId, type ChatRoleId,
} from '../../../../../application/chat/ChatRole';

/** 与功能助手 'chat-session' 隔离，导出/清空天然只覆盖对话页会话 */
const CHAT_CATEGORY = 'chat-conversation';
const LAST_SESSION_KEY = 'chat:lastSessionId';
const DB_NAME = 'weiqi-assistant';
const DB_STORE = 'favorites';

/** 面板操作后的定位目标：按卡片 data-panel-key 找回刚操作的条目。
 *  enableHint 为真时，额外在列表顶部插一条「需手动启用」的醒目提示（仅插件新装）。 */
interface PanelFocus {
  key: string;
  enableHint?: boolean;
}

export class ChatPage {
  private readonly renderer = new AssistantRenderer();
  private readonly dialog = new WebDialog();
  private readonly exporter = new WebFileExporter();
  private history!: ChatHistoryManager;
  private useCase!: ChatUseCase;
  private plugin: PluginSystem | undefined;
  /** 在线插件平台：复用同一套工件服务与沙箱运行时，装配失败时降级为不可用 */
  private catalog: PluginCatalogService | undefined;
  /** 插件面板当前标签页；默认本地插件（不改变原有入口行为） */
  private pluginPanelTab: 'local' | 'online' = 'local';
  /** 一次性操作反馈，随下一次面板渲染出现后清空 */
  private pluginPanelFlash: { text: string; error: boolean } | undefined;
  /** 操作后要定位回的条目；新装插件带 enableHint，切到本地页并提示手动启用 */
  private pluginPanelFocus: PanelFocus | undefined;
  /** 面板刷新序号：异步 list() 期间用户可能关掉/重开面板，旧结果必须丢弃 */
  private pluginPanelSeq = 0;
  /** 技能编排服务：loadSkills / browse / 源管理 / 自建技能库共用同一实例 */
  private skillCatalog: SkillCatalogService | undefined;
  /** 宿主原语注册表：面板标注「在线技能引用了没有的原语」时复用 */
  private skillPrimitives: ReadonlyMap<string, SkillPrimitive> | undefined;
  /** 本地数据层：凭据弹框与 http_fetch_auth 共用同一 service 实例 */
  private kvKit: KvKit | undefined;
  /** 配方声明的凭据规格表：每轮由 loadSkills 用已启用配方刷新，模型无法写入 */
  private secretSpecs: ReturnType<typeof createSecretSpecRegistry> | undefined;
  /** 技能面板当前标签页；默认「我的技能」 */
  private skillPanelTab: 'local' | 'online' = 'local';
  private skillPanelFlash: { text: string; error: boolean } | undefined;
  /** 技能操作后要定位回的条目（按 recipe.id） */
  private skillPanelFocus: PanelFocus | undefined;
  private skillPanelSeq = 0;
  /** 当前会话的模型角色。角色绑定会话，切换角色会新建会话。 */
  private currentRole: ChatRoleId = DEFAULT_ROLE_ID;
  /** 待发送的本地附件（发送瞬间清空；不进 DOM 的 base64） */
  private pendingFiles: LocalFileInput[] = [];

  /** 入口注入：proxyUrl 由 vite 域的 chat.ts 算好（三端分流），此处只接收 */
  async init(options?: { proxyUrl?: string }): Promise<void> {
    // 附件按钮是纯 DOM 行为，必须第一时间可用：后面 IndexedDB / 插件系统 /
    // 会话恢复任何一个 await 卡住或抛错，都不该让用户点 📎 毫无反应。
    this.bindAttachUI();

    const storage = new IndexedDBAdapter<{ id: string; category: string; key: string; createdAt: number }>(
      DB_NAME, DB_STORE,
    );
    await storage.initialize();
    this.history = new ChatHistoryManager(new FavoriteService(storage), CHAT_CATEGORY);

    // 插件系统作为「可选能力」装配：装上了也只在 plugin 角色下启用。
    // 任何装配异常都不阻塞对话页：降级为纯聊天是设计内的兜底，不是错误吞掉。
    try {
      this.plugin = await createPluginSystem();
      // 在线平台与本地插件共用同一个工件服务 + 沙箱运行时：
      // 安装 = create（写前先 QuickJS 试跑）、更新 = revise，
      // 绝不绕过「默认停用」的人工闸门与 QuickJS 隔离。
      this.catalog = new PluginCatalogService({
        artifacts: this.plugin.artifacts,
        runtime: this.plugin.runtime,
      });
    } catch {
      this.plugin = undefined;
      this.catalog = undefined;
    }
    // 网络工具依赖：代理地址由入口注入（三端分流，线上只给纯 Web），超时
    // 沿用已配置的 LLM timeoutMs —— 不引入任何新数值。chat 角色才用得到。
    const gateway = this.plugin?.gateway ?? new OpenAIModelGateway();
    // web 工具每次执行都读 /proxy 覆盖值（单一真相源）：入口注入的 proxyUrl
    // 只是没有覆盖值时的兜底，避免在 ChatPage 里固化一份运行期快照。
    const injectedProxyUrl = options?.proxyUrl ?? 'https://api.weiqi.lol';
    const config = loadLLMConfig();
    const webTools = {
      get proxyUrl(): string { return loadWebProxyOverride() ?? injectedProxyUrl; },
      timeoutMs: config?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
    };
    // 技能是安装制：本地库是唯一生效来源，在线源只浏览/安装，绝不自动叠加。
    // - primitives 是宿主内置且固定的执行器注册表（基础 web 原语 + 赛事导入两阶段原语），
    //   同时供 selectSkills 挂工具、面板标「缺原语不可装」、SkillCatalogService 安装校验；
    // - 本地技能库 / 在线源管理 / 面板 / 开发工具共用同一批实例；
    // - 装配失败也不阻塞对话页，绝不在运行时加载 / 执行远程 JS。
    const userSkills = new UserSkillStore();
    const skillSources = new SkillCatalogSources();
    // 本地数据层：原语并入宿主注册表（供技能配方引用 / 面板校验），
    // kit 同时交给 ChatUseCase 做 chat 角色的恒定工具注入与 system 说明。
    const kvKit = createKvKit();
    this.kvKit = kvKit;
    // 通用凭据规格表：装配期空表，每轮 loadSkills 用「已启用配方」刷新。
    // http_fetch_auth 只按 secretKey 查这里，allowedHosts / header 拼法模型传不进来。
    const secretSpecs = createSecretSpecRegistry();
    this.secretSpecs = secretSpecs;
    const skillPrimitives = createSkillRegistry([
      ...createBasicPrimitives(webTools),
      ...kvKit.primitives,
      ...EVENT_PRIMITIVES,
      // 通用带凭据直连：模型只给 url + secretKey，域名白名单 / header / 重认证
      // 状态全由配方 secrets 声明，宿主按 secretKey 查表执行。
      ...createAuthFetchPrimitives({
        kv: kvKit.service,
        specs: secretSpecs,
        timeoutMs: webTools.timeoutMs,
      }),
    ]);
    this.skillPrimitives = skillPrimitives;
    // 面板与对话侧共用同一份能力库清单：requiredCapabilities 的判定口径必须同源，
    // 否则会出现「面板说能装、对话却不激活」的劈叉。llmToolKit 装配失败时 undefined
    // = 不注入检查器（面板保守跳过依赖检查），对话侧仍以空集做激活前硬门槛。
    const llmKit = this.plugin?.llmToolKit;
    this.skillCatalog = createDefaultSkillCatalog({
      users: userSkills, sources: skillSources, primitives: skillPrimitives,
      ...(llmKit !== undefined
        ? { capabilities: () => llmKit.listCapabilities() }
        : {}),
    });
    const skillDeps: SkillDeps = {
      loadSkills: async () => {
        const recipes = await this.skillCatalog!.loadSkills();
        try {
          this.secretSpecs?.replace(collectSecretSpecs(recipes));
        } catch {
          // 多条配方声明了同名但不一致的凭据：宁可本轮不认任何规格，
          // 也不要静默挑一份把凭据发到不确定的 host。
          this.secretSpecs?.replace([]);
        }
        return recipes;
      },
      primitives: skillPrimitives,
      // 只有「技能开发」角色会挂这俩工具；闲聊角色完全不接触
      devKit: createSkillDevKit({ users: userSkills, primitives: skillPrimitives }),
    };
    this.useCase = new ChatUseCase(
      gateway,
      this.history,
      this.renderer,
      // plugin 角色只挂插件工具集，与闲聊共用同一个标准 tool-calling loop
      this.plugin?.toolKit,
      // 角色由页面持有，用例只读取、不猜测、不持久化
      () => this.currentRole,
      webTools,
      skillDeps,
      // llm-tool 能力库：与插件系统共用工件存储 + QuickJS 沙箱，装配失败时 undefined（降级为纯聊天）
      this.plugin?.llmToolKit,
      // Skill 本地数据层：域 / 驱动 / 能力均在 createKvKit() 内注册，装配方只传这一句
      kvKit,
      // 会话上下文 compact：host-only 写 checkpoints 域（kvKit.service 的宿主专用接口），
      // 摘要走同一个 gateway 的 chat.compact 旁路任务。不挂任何模型工具。
      new ConversationCompactor({ gateway, store: kvKit.service }),
    );

    this.bindUI();
    this.bindLifecycle();
    this.bindEventTableLinks();
    this.bindSecretPromptLinks();
    this.bindPrefLinks();
    // 先恢复上次会话（它会顺带定下该会话的角色），再刷新角色 UI 与输入状态
    await this.restoreLastSession();
    this.syncRoleUI();
    this.syncReadyState();

    // 深链：赛事详情页 ⚙️ 菜单的「管理插件 →」带 ?panel=plugins 进来，
    // 初始化完成后直接打开插件管理面板，用户不用再点一次右上角菜单。
    if (new URLSearchParams(window.location.search).get('panel') === 'plugins') {
      void this.showPluginPanel();
    }
  }

  /**
   * 「表格编辑」工具返回的 event-table: 链接 → 打开可编辑对阵表弹框。
   *
   * 用 document 上的事件委托而非在渲染器里逐个 a 标签绑 click：回复走 marked +
   * 打字机异步注入 DOM，渲染完成时链接可能还没出现；委托也能覆盖历史消息恢复
   * （prependMessage）里重新渲染出来的旧链接。
   *
   * 弹框「导入」校验通过后回调这里，走的是**正常 send() 路径**：
   * - ChatUseCase.send 会调 beginUserTurn() 推进人工确认闸门，因此 LLM 可以在
   *   这一轮调 event_commit_draft 写库（同一条消息里自动写库仍被硬闸门拒绝）；
   * - 历史里仍带图片附件，selectSkills 继续命中 event.import* 技能，commit 工具
   *   保持挂载。
   * 用户看到的是自己发出的一条确认消息，不是宿主偷偷替他说话。
   */
  private bindEventTableLinks(): void {
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest('a[href^="event-table:"]') as HTMLAnchorElement | null;
      if (!link) return;
      event.preventDefault();
      const token = link.getAttribute('href')?.slice('event-table:'.length) ?? '';
      if (!token) return;
      openEventTableDialog(token, () => {
        void this.sendEventTableImport();
      });
    });
  }

  /** 弹框点「导入」后发出的确认消息：只描述意图，不复述数据 */
  private async sendEventTableImport(): Promise<void> {
    // 「导入赛事」是技能触发词：图片通道靠 hasImagePart 挂载，纯文字/历史窗口
    // 滑出图片时靠触发词兜底，保证这一轮 event_commit_draft 一定可用。
    const text =
      '导入赛事：我已在对阵表弹框里核对并确认（可能已修改）全部场次，请调用 event_commit_draft 把这份草稿写入赛事库。';
    // 直接走用例：send() 内部负责渲染用户气泡、落盘、beginUserTurn 闸门推进。
    // 不复用 handleSend()，避免清空用户尚未发送的草稿文字、误带待发附件、
    // 或触发一次无意义的标题精炼。
    await this.useCase.send(text);
  }

  /**
   * 通用凭据配置链接（secret-prompt:<key>）→ 按 key 查规格 → 打开录入 / 修改弹框。
   *
   * 与 event-table: 同款：用 document 事件委托而非给每个 a 标签绑 click ——
   * 回复走 marked + 打字机异步注入 DOM，渲染完成时链接可能还没出现；委托也能
   * 覆盖历史消息恢复里重新渲染出来的旧链接。
   *
   * 弹框保存成功后回灌一条用户消息，走正常 useCase.send() 路径：
   * LLM 在新一轮里重新调 http_fetch_auth，这次宿主能读到凭据直接成功。
   * 用户看到的是自己发出的一条确认消息，不是宿主偷偷替他说话。
   */
  private bindSecretPromptLinks(): void {
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest<HTMLAnchorElement>('a[href^="secret-prompt:"]');
      if (!link) return;
      event.preventDefault();
      const key = link.getAttribute('href')?.slice(SECRET_PROMPT_SCHEME.length) ?? '';
      const spec = this.secretSpecs?.get(key);
      if (!spec || !this.kvKit) return;
      openSecretPromptDialog(this.kvKit.service, spec, () => {
        void this.useCase.send('凭据已配置好，请继续刚才的请求。');
      });
    });
  }

  /**
   * 本地偏好写入链接（通用 prefs-add:<domain>:<key>:<value>，兼容旧
   * stock-watch-add:<代码>）→ 回灌一条用户消息交给 LLM。
   *
   * 与 secret-prompt: 的**关键差别**：这里宿主一行存储都不写。prefs 域是
   * readable / model 写，就是设计给「LLM 调用本地存储接口」用的；宿主只负责把
   * 用户点了一下这个事实变成一条正常用户消息，读写由 LLM 按技能配方调 kv_read /
   * kv_write 完成，回执也由 LLM 给。这样模型上下文里始终有这份偏好，不会出现
   * 「宿主偷偷写了，模型下一轮却不知道」的劈叉。
   *
   * 2026-11-19 通用化：宿主**不认识任何业务键名**（weather.watchlist /
   * stock.watchlist 都由配方声明），新增 skill 存偏好只改配方、不改宿主。
   *
   * 用 document 事件委托（同 event-table: / secret-prompt:）：回复走 marked +
   * 打字机异步注入 DOM，委托也能覆盖历史消息恢复后重新渲染出来的旧链接。
   * 链接只经形状校验，不携带整份待写入结构 / URL / JSON。
   */
  private bindPrefLinks(): void {
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const href = target?.closest<HTMLAnchorElement>(
        `a[href^="${PREF_ADD_SCHEME}"], a[href^="${PREF_ADD_WATCH_SCHEME}"]`,
      )?.getAttribute('href') ?? null;
      if (!href) return;
      event.preventDefault(); // 本 scheme 一律不交给浏览器导航
      // 通用 scheme 优先；旧股票 scheme 作历史兼容。脏串一律静默忽略。
      const general = parsePrefAddHref(href);
      let message: string | null = null;
      if (general) {
        message = prefAddUserMessage(general);
      } else {
        const code = parseWatchAddCode(href);
        if (code) message = watchAddUserMessage(code);
      }
      if (!message) return; // 形状不合法：绝不把脏 href 回灌成用户消息
      void this.useCase.send(message);
    });
  }

  /**
   * 对话页是独立多页应用，页面真正卸载时显式终止插件的 QuickJS Worker。
   * 进入 bfcache（event.persisted）时不 dispose —— 返回页面还要继续用同一套插件系统。
   */
  private bindLifecycle(): void {
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return;
      // dispose() 是异步的；卸载阶段无法 await，显式吞掉 rejection 避免 floating promise。
      void this.plugin?.dispose().catch(() => { /* 卸载阶段不抛 */ });
    });
  }

  // ---------- UI 绑定 ----------

  private bindUI(): void {
    this.bindAttachUI();
    const input = document.getElementById('userInput') as HTMLTextAreaElement | null;
    const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });
    input?.addEventListener('input', () => this.autoResize(input));
    sendBtn?.addEventListener('click', () => void this.handleSend());

    // 菜单五项 + 遮罩关闭
    document.getElementById('menuBtn')?.addEventListener('click', () => this.toggleMenu());
    document.getElementById('menuOverlay')?.addEventListener('click', () => this.toggleMenu(false));
    document.getElementById('miNew')?.addEventListener('click', () => void this.newSession());
    document.getElementById('miHistory')?.addEventListener('click', () => void this.showHistory());
    document.getElementById('miExport')?.addEventListener('click', () => void this.exportCurrent());
    document.getElementById('miClear')?.addEventListener('click', () => void this.clearCurrent());
    document.getElementById('miPlugin')?.addEventListener('click', () => void this.showPluginPanel());
    document.getElementById('miSkill')?.addEventListener('click', () => void this.showSkillPanel());

    // 标题栏角色选择器
    document.getElementById('roleBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleRoleMenu();
    });
    // 点页面别处收起角色下拉
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('#roleBtn') && !target.closest('#roleMenu')) {
        this.toggleRoleMenu(false);
      }
    });
  }

  /**
   * 供入口在 resolveProxyUrl() 之前调用：App 端的 window.prompt('config:get')
   * 是原生桥接，可能挂起，不能让附件按钮等它回来才可用。幂等。
   */
  bindEarlyUI(): void {
    this.bindAttachUI();
  }

  /**
   * 附件绑定单独抽出、可重复调用（入口 + init 早期 + bindUI 各一次）。
   * 用 onclick / onchange 赋值而非 addEventListener：天然幂等，不会重复绑定。
   */
  private bindAttachUI(): void {
    const attachBtn = document.getElementById('attachBtn') as HTMLButtonElement | null;
    const attachInput = document.getElementById('attachInput') as HTMLInputElement | null;
    if (attachBtn && attachInput) {
      attachBtn.onclick = () => attachInput.click();
      attachInput.onchange = () => {
        if (attachInput.files) {
          for (const file of Array.from(attachInput.files)) this.pendingFiles.push(file);
        }
        // 允许连续选同一个文件：清空 input 的 value
        attachInput.value = '';
        this.renderAttachPreview();
      };
    }
  }

  private autoResize(input: HTMLTextAreaElement): void {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  private toggleMenu(force?: boolean): void {
    const menu = document.getElementById('commandMenu');
    const overlay = document.getElementById('menuOverlay');
    if (!menu || !overlay) return;
    const show = force ?? (menu.style.display !== 'block');
    menu.style.display = show ? 'block' : 'none';
    overlay.style.display = show ? 'block' : 'none';
  }

  private syncReadyState(): void {
    const ready = this.useCase.isReady();
    const input = document.getElementById('userInput') as HTMLTextAreaElement | null;
    const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;
    const banner = document.getElementById('notReady');
    if (input) {
      input.disabled = !ready;
      // placeholder 跟着角色走（不能用写死的「继续对话…」把角色专属提示冲掉）
      input.placeholder = ready ? getRole(this.currentRole).placeholder : '请先到功能助手配置 LLM';
    }
    if (sendBtn) sendBtn.disabled = !ready;
    // 📎 故意不管 ready：选文件是纯本地行为，不该被 LLM 配置挡住。
    // 未就绪时仍可选，发送时再给明确提示（见 handleSend）。
    if (banner) banner.style.display = ready ? 'none' : 'block';
  }

  /** 是否 PDF：预览图标与「PDF 读取方式」选择器共用同一口径 */
  private isPdfFile(file: { name: string; type: string }): boolean {
    return /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  }

  /** 附件预览：只显示文件名，绝不把 base64 / 文件内容拼进 DOM */
  private renderAttachPreview(): void {
    const root = document.getElementById('attachPreview');
    const mode = document.getElementById('attachMode');
    const btn = document.getElementById('attachBtn');
    if (!root) return;
    root.textContent = '';
    const has = this.pendingFiles.length > 0;
    // 「PDF 读取方式」只在真的有 PDF 时出现：纯图片附件不该看到无关选项
    const hasPdf = this.pendingFiles.some((f) => this.isPdfFile(f));
    root.style.display = has ? 'flex' : 'none';
    if (mode) mode.style.display = hasPdf ? 'flex' : 'none';
    btn?.classList.toggle('attach-btn--on', has);
    this.pendingFiles.forEach((file, index) => {
      const chip = document.createElement('span');
      chip.className = 'attach-chip';
      const name = document.createElement('span');
      name.className = 'attach-chip__name';
      const icon = this.isPdfFile(file) ? '📄' : '🖼️';
      name.textContent = `${icon} ${file.name}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'attach-chip__x';
      remove.title = '移除';
      remove.setAttribute('aria-label', `移除 ${file.name}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        this.pendingFiles.splice(index, 1);
        this.renderAttachPreview();
      });
      chip.append(name, remove);
      root.append(chip);
    });
  }

  private async handleSend(): Promise<void> {
    const input = document.getElementById('userInput') as HTMLTextAreaElement | null;
    if (!input) return;
    if (input.disabled) {
      // 未配置 LLM 时输入被禁用，但附件按钮仍可用；别让用户点了发送没反应。
      const banner = document.getElementById('notReady');
      if (banner) banner.style.display = 'block';
      return;
    }
    const text = input.value.trim();
    const files = this.pendingFiles;
    // 纯附件无文字时补一句明确的问题，不让模型对着一张图猜用户要什么
    if (!text && files.length === 0) return;
    const modeEl = document.getElementById('pdfMode') as HTMLSelectElement | null;
    const pdfMode = modeEl?.value === 'native' ? 'native' : 'text';
    input.value = '';
    this.autoResize(input);
    this.pendingFiles = [];
    this.renderAttachPreview();
    // 会话标题：首轮发送后旁路请模型概括成短标题。
    // 发起前记下 sessionId —— 模型返回前用户可能切走，写回时必须复核。
    const isFirstUserTurn = (this.history.getCurrentSession()?.messages ?? [])
      .filter((m) => m.role === 'user').length === 0;
    const titleSessionId = this.history.getCurrentSession()?.sessionId;
    const titleSourceText = text || '请阅读我附加的文件并说明其内容。';
    await this.useCase.send(titleSourceText, {
      ...(files.length > 0 ? { files } : {}),
      pdfMode,
    });
    if (isFirstUserTurn && titleSessionId) {
      // 先立刻刷新一次：send() 已写入短兜底标题，短输入（无需精炼）也要能看到。
      void this.updateTitle();
      // 刻意 fire-and-forget：标题只是展示增强，不该拖慢主流程，更不能让一个
      // 可能挂起的模型请求卡住 handleSend 收尾。精炼结果由 refineSessionTitle
      // 直接写进会话存储，页面离开只是少一次即时刷新，数据不会丢；失败静默降级。
      void this.useCase.refineSessionTitle(titleSourceText, titleSessionId)
        .then((refined) => { if (refined) void this.updateTitle(); })
        .catch(() => { /* 标题精炼失败不影响对话 */ });
    }
    // Agent 可能在本轮里启停/新建/删除插件。若面板正开着，立即重列，
    // 避免用户看到的是发送前的旧状态（「模型说已启用，面板仍禁用」的一半成因）。
    // 面板没打开时 refreshPluginPanel 会因找不到 root 直接返回，成本为零。
    if (this.plugin && document.getElementById('pluginPanelRoot')) {
      await this.refreshPluginPanel();
    }
  }

  // ---------- 模型角色 ----------

  /**
   * 从会话数据里读角色。角色归属会话本身（ChatSessionData.role），
   * 不依赖页面侧 localStorage —— 换设备 / 清缓存 / 从历史列表打开都不会弄错。
   * 老会话没有 role 字段时回退默认（闲聊），向后兼容。
   */
  private async readSessionRole(sessionId: string): Promise<ChatRoleId> {
    const sessions = await this.history.getAllSessions();
    const data = sessions.find((s) => s.sessionId === sessionId)?.data;
    return parseRoleId(data?.role) ?? DEFAULT_ROLE_ID;
  }

  /** 把角色固化进当前会话数据（一旦写入，后续保存都会保留） */
  private async writeSessionRole(role: ChatRoleId): Promise<void> {
    await this.history.setCurrentSessionRole(role);
    localStorage.setItem(ROLE_STORAGE_KEY, role); // 只用于「全新用户默认角色」
  }

  /** 当前会话是否已有聊天记录（有则角色锁定，不允许切换） */
  private currentSessionHasMessages(): boolean {
    return (this.history.getCurrentSession()?.messages.length ?? 0) > 0;
  }

  /**
   * 切换角色 = 新建会话。但**已有聊天记录的会话不能切换** ——
   * 角色决定 system prompt 与背景知识，中途换角色会让同一段历史被
   * 两套不同的知识体系解释，上下文彻底乱套。用户须先新建会话。
   */
  private async switchRole(roleId: ChatRoleId): Promise<void> {
    const role = getRole(roleId);
    this.toggleRoleMenu(false);

    if (role.id === this.currentRole) return; // 点当前角色，什么都不做

    if (this.currentSessionHasMessages()) {
      await this.renderer.renderMessage(
        `当前会话已有聊天记录，角色已固定为「${getRole(this.currentRole).label}」，不能切换。`
        + '请点右上角「新建会话」后再选择角色。',
        false, null, null, undefined, undefined, false,
      );
      return;
    }

    // 空会话允许直接换角色：没有历史需要保持一致的解释口径。
    // 直接改写这个空会话的角色，不另建会话 —— 避免留下一堆空会话垃圾。
    this.currentRole = role.id;
    await this.writeSessionRole(role.id);
    await this.renderer.renderMessage(
      `已切换到「${role.label}」角色：${role.description}。`,
      false, null, null, undefined, undefined, false,
    );
    this.syncRoleUI();
    this.syncReadyState();
  }

  /** 角色是否被当前会话锁定（供 UI 显示「已固定」提示） */
  private isRoleLocked(): boolean {
    return this.currentSessionHasMessages();
  }

  /** 标题栏角色按钮 + 下拉：常驻可见，一眼知道当前是什么角色、是否已锁定 */
  private syncRoleUI(): void {
    const role = getRole(this.currentRole);
    const locked = this.isRoleLocked();
    const btn = document.getElementById('roleBtn');
    if (btn) {
      // 动态文本一律 textContent，绝不拼进 innerHTML
      btn.textContent = locked
        ? `${role.icon} ${role.label} 🔒`
        : `${role.icon} ${role.label} ▾`;
      btn.setAttribute('aria-label', locked
        ? `当前角色：${role.label}，本会话已固定`
        : `当前角色：${role.label}，点击切换`);
      btn.classList.toggle('role-btn--locked', locked);
    }
    const input = document.getElementById('userInput') as HTMLTextAreaElement | null;
    if (input && !input.disabled) input.placeholder = role.placeholder;

    const menu = document.getElementById('roleMenu');
    if (menu) {
      menu.textContent = '';
      if (locked) {
        const hint = document.createElement('div');
        hint.className = 'role-menu__hint';
        hint.textContent = '本会话已有聊天记录，角色已固定。新建会话后可重新选择。';
        menu.append(hint);
      }
      for (const item of CHAT_ROLES) {
        const row = document.createElement('button');
        row.type = 'button';
        const isCurrent = item.id === this.currentRole;
        const disabled = locked && !isCurrent;
        row.className = 'role-option'
          + (isCurrent ? ' is-active' : '')
          + (disabled ? ' is-disabled' : '');
        row.disabled = disabled;
        const title = document.createElement('span');
        title.className = 'role-option__title';
        title.textContent = `${item.icon} ${item.label}`;
        const desc = document.createElement('span');
        desc.className = 'role-option__desc';
        desc.textContent = disabled ? '当前会话已锁定，新建会话后可切换' : item.description;
        row.append(title, desc);
        if (!disabled) row.addEventListener('click', () => void this.switchRole(item.id));
        menu.append(row);
      }
    }
  }

  private toggleRoleMenu(force?: boolean): void {
    const menu = document.getElementById('roleMenu');
    if (!menu) return;
    const show = force ?? (menu.style.display !== 'block');
    menu.style.display = show ? 'block' : 'none';
    // 切换角色菜单时顺手关掉右上角菜单，避免两层浮层叠着
    if (show) this.toggleMenu(false);
  }

  // ---------- 会话管理 ----------

  private async restoreLastSession(): Promise<void> {
    const lastId = localStorage.getItem(LAST_SESSION_KEY);
    if (lastId) {
      const messages = await this.history.loadSession(lastId);
      if (messages) {
        // 角色从会话数据本身恢复，不靠页面侧映射
        this.currentRole = await this.readSessionRole(lastId);
        await this.renderSession(messages);
        return;
      }
      localStorage.removeItem(LAST_SESSION_KEY);
    }
    // 没有上次会话：取最近一个，仍没有就新建一个空会话
    const sessions = await this.history.getAllSessions();
    if (sessions.length > 0) {
      const recent = sessions.sort((a, b) => b.data.updatedAt - a.data.updatedAt)[0]!;
      const messages = await this.history.loadSession(recent.sessionId);
      if (messages) {
        localStorage.setItem(LAST_SESSION_KEY, recent.sessionId);
        this.currentRole = await this.readSessionRole(recent.sessionId);
        await this.renderSession(messages);
        return;
      }
    }
    // 全新用户：沿用上次选的角色（默认闲聊）
    this.currentRole = parseRoleId(localStorage.getItem(ROLE_STORAGE_KEY)) ?? DEFAULT_ROLE_ID;
    await this.newSession(false);
  }

  private async renderSession(messages: ChatMessage[]): Promise<void> {
    this.renderer.clearMessages();
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    for (const msg of sorted) {
      // 历史恢复不用打字机，避免刷新后逐字动画
      await this.renderer.renderMessage(
        msg.content, msg.role === 'user', null, null,
        msg.actionUrl, msg.actionText, false, undefined, msg.timestamp,
      );
      // 附件摘要跟在该条气泡后面：只显示文件名/类型，绝不打印 base64。
      // 资源本体由 buildConversationMessages 重放进模型上下文（多轮追问）。
      if (msg.attachments?.length) {
        const holder = document.createElement('div');
        holder.className = 'msg-attachments';
        for (const a of msg.attachments) {
          const chip = document.createElement('span');
          chip.className = 'msg-attachment';
          chip.textContent = describeAttachment(a);
          holder.append(chip);
        }
        const container = document.getElementById('chatContainer');
        // 取最后一条消息气泡（容器里可能还有状态/打字指示器等其它节点，
        // :last-child 不一定指向气泡）
        const bubbles = container?.querySelectorAll('.message');
        const lastBubble = bubbles?.item(bubbles.length - 1);
        (lastBubble ?? container)?.append(holder);
      }
    }
    void this.updateTitle();
    this.scrollToBottom();
  }

  private async newSession(clearUI = true): Promise<void> {
    const id = await this.history.createSession('新对话');
    localStorage.setItem(LAST_SESSION_KEY, id);
    // 角色固化进会话数据：新建的会话沿用当前角色
    // （切换角色时会先改 currentRole 再调这里）
    await this.writeSessionRole(this.currentRole);
    if (clearUI) {
      this.renderer.clearMessages();
      void this.updateTitle();
    }
    // 新会话不该把上一个会话里没发的附件带过去
    this.pendingFiles = [];
    this.renderAttachPreview();
    this.toggleMenu(false);
    this.syncRoleUI();
    this.syncReadyState();
  }

  /**
   * 标题栏显示会话数据里的 title（模型精炼后的短标题写在这里）。
   * 此前这里从消息里重算，导致 ChatUseCase 写进存储的 title 根本没被读到。
   * 统一再过一次 clampTitle，保证任何来源的标题都不超展示上限。
   */
  private async updateTitle(): Promise<void> {
    const el = document.getElementById('chatTitle');
    if (!el) return;
    const stored = await this.history.getCurrentSessionWithTitle();
    const title = stored ? clampTitle(stored.title) : '新对话';
    el.textContent = title;
    el.setAttribute('title', title); // 桌面端悬停可看全（精炼后本就很短）
  }

  /** 兜底标题：第一条 user 消息压平后截断到展示上限（不碰附件/base64） */
  private sessionTitle(meta: { sessionId: string; messages: ChatMessage[] }): string {
    const first = meta.messages.find((m) => m.role === 'user');
    return first ? clampTitle(first.content) : '新对话';
  }

  private scrollToBottom(): void {
    const container = document.getElementById('chatContainer');
    if (container) container.scrollTop = container.scrollHeight;
  }

  // ---------- 历史会话弹框：卡片式，显示时间 + 摘要 ----------

  private async showHistory(): Promise<void> {
    this.toggleMenu(false);
    const sessions = (await this.history.getAllSessions())
      .sort((a, b) => b.data.updatedAt - a.data.updatedAt);
    const currentId = this.history.getCurrentSession()?.sessionId;

    const cards = sessions.length === 0
      ? '<div class="session-empty">暂无历史会话</div>'
      : sessions.map((s) => {
        const active = s.sessionId === currentId ? ' session-card--active' : '';
        const time = this.formatTime(s.data.updatedAt);
        const summary = this.escapeHtml(this.sessionTitleFromSession(s));
        // 角色标识：从会话数据本身读取。老会话（角色字段落地前创建的）
        // 没有 role，按默认闲聊回退，并标「旧」提示这是回退值而非确证。
        const stored = parseRoleId(s.data.role);
        const role = getRole(stored ?? DEFAULT_ROLE_ID);
        const roleLabel = stored ? `${role.icon} ${role.label}` : `${role.icon} ${role.label}（旧）`;
        const roleBadge = `<span class="session-card__role">${this.escapeHtml(roleLabel)}</span>`;
        return `<div class="session-card${active}" data-session-id="${this.escapeHtml(s.sessionId)}">
          <div class="session-card__body">
            <div class="session-card__time">${time}${roleBadge}</div>
            <div class="session-card__summary">${summary}</div>
          </div>
          <button type="button" class="session-card__delete" title="删除会话" aria-label="删除会话">🗑</button>
        </div>`;
      }).join('');

    // show() 是阻塞式 Promise（点「关闭」才 resolve），不能 await 后再绑事件；
    // 先发起显示（DOM 同步插入），再绑定卡片点击。
    void this.dialog.show({
      // alert 类型不渲染任何按钮，用户只能点遮罩关闭；用 custom 给一个明确的关闭入口。
      type: 'custom',
      title: '历史会话',
      content: `<div class="session-list">${cards}</div>`,
      buttons: [{ id: 'close', text: '关闭' }],
    });
    this.bindSessionCards();
  }

  private bindSessionCards(): void {
    document.querySelectorAll<HTMLElement>('.session-card').forEach((card) => {
      card.addEventListener('click', async (event) => {
        // 删除按钮在卡片内，冒泡上来的点击不能顺手把会话又打开一遍
        if ((event.target as HTMLElement).closest('.session-card__delete')) return;
        this.dialog.close();
        const id = card.getAttribute('data-session-id');
        if (!id) return;
        const messages = await this.history.loadSession(id);
        if (!messages) return;
        localStorage.setItem(LAST_SESSION_KEY, id);
        // 关键：打开历史会话必须恢复它自己的角色，否则会用上一个会话的角色
        // 去解释这段历史（system prompt / 插件能力全错）。
        this.currentRole = await this.readSessionRole(id);
        await this.renderSession(messages);
        this.syncRoleUI();
        this.syncReadyState();
      });
      const deleteBtn = card.querySelector<HTMLButtonElement>('.session-card__delete');
      deleteBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.confirmDeleteSession(card);
      });
    });
  }

  /**
   * 删除会话走卡片内联二次确认：WebDialog 是单例，不能嵌套弹确认框；
   * window.confirm 在 WebView 里行为不可控，与插件面板的删除保持一致。
   * 卡片上的会话标题只用于确认文案，textContent 写入防注入。
   */
  private async confirmDeleteSession(card: HTMLElement): Promise<void> {
    const id = card.getAttribute('data-session-id');
    if (!id || card.querySelector('.session-card__confirm')) return;

    const summary = card.querySelector('.session-card__summary')?.textContent ?? '';
    const bar = document.createElement('div');
    bar.className = 'session-card__confirm';
    // 整个确认栏的点击都不得冒泡到卡片（卡片 click = 打开该会话）
    bar.addEventListener('click', (e) => e.stopPropagation());
    const tip = document.createElement('span');
    tip.textContent = summary ? `确认删除「${summary}」？` : '确认删除该会话？';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'session-card__confirm-yes';
    yes.textContent = '确认删除';
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = '取消';
    no.addEventListener('click', () => bar.remove());
    yes.addEventListener('click', () => void (async () => {
      // deleteSession 会清空当前会话指针，是否删掉当前会话必须在调用前判定
      const wasCurrent = this.history.getCurrentSession()?.sessionId === id;
      try {
        await this.history.deleteSession(id);
        bar.remove();
        await this.afterSessionDeleted(id, wasCurrent);
      } catch (error) {
        tip.textContent = `删除失败：${error instanceof Error ? error.message : String(error)}`;
      }
    })());
    bar.append(tip, yes, no);
    card.append(bar);
  }

  /**
   * 删除后的页面收尾：列表即时刷新（不重开 dialog），若删的是当前会话，
   * 视图不能停在一个已删除的会话上 —— 切到剩余最近会话，没有就新建空会话。
   * 角色始终跟随实际打开的会话，避免用旧角色解释新会话。
   */
  private async afterSessionDeleted(sessionId: string, wasCurrent: boolean): Promise<void> {
    const list = document.querySelector('.session-list');
    const card = Array.from(document.querySelectorAll<HTMLElement>('.session-card'))
      .find((c) => c.getAttribute('data-session-id') === sessionId);
    card?.remove();
    if (list && !list.querySelector('.session-card')) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = '暂无历史会话';
      list.append(empty);
    }

    if (!wasCurrent) return;
    if (sessionId === localStorage.getItem(LAST_SESSION_KEY)) {
      localStorage.removeItem(LAST_SESSION_KEY);
    }
    // 防御：存储层是异步的，个别实现可能仍列出刚删的 id，显式排除
    const remaining = (await this.history.getAllSessions())
      .filter((item) => item.sessionId !== sessionId)
      .sort((a, b) => b.data.updatedAt - a.data.updatedAt);
    const next = remaining[0];
    if (next) {
      const messages = await this.history.loadSession(next.sessionId);
      if (messages) {
        localStorage.setItem(LAST_SESSION_KEY, next.sessionId);
        this.currentRole = await this.readSessionRole(next.sessionId);
        await this.renderSession(messages);
      } else {
        await this.newSession();
      }
    } else {
      await this.newSession();
    }
    this.syncRoleUI();
    this.syncReadyState();
  }

  private sessionTitleFromSession(s: ChatSession): string {
    const stored = s.data.title?.trim();
    return stored
      ? clampTitle(stored)
      : this.sessionTitle({ sessionId: s.sessionId, messages: s.data.messages ?? [] });
  }

  // ---------- 导出 / 清空（仅当前会话） ----------

  private async exportCurrent(): Promise<void> {
    this.toggleMenu(false);
    const meta = this.history.getCurrentSession();
    if (!meta || meta.messages.length === 0) {
      await this.renderer.renderMessage('当前会话暂无消息可导出。', false, null, null, undefined, undefined, false);
      return;
    }
    const stored = await this.history.getCurrentSessionWithTitle();
    const filename = `weiqi-chat-${new Date().toISOString().slice(0, 10)}.json`;
    const result = await this.exporter.exportJSON(
      {
        sessionId: meta.sessionId,
        title: clampTitle(stored?.title ?? this.sessionTitle(meta)),
        // 角色是会话固有属性，导出一并带上，避免回灌后角色丢失
        role: this.currentRole,
        messages: meta.messages,
      },
      filename,
    );
    const hasAttachments = meta.messages.some((m) => m.attachments?.length);
    const note = result.success && hasAttachments
      ? '（含 PDF/图片附件的 base64，文件可能较大，请自行保管）'
      : '';
    await this.renderer.renderMessage(
      (result.success ? `已导出当前会话（${meta.messages.length} 条消息）` : `导出失败：${result.error ?? '未知错误'}`) + note,
      false, null, null, undefined, undefined, false,
    );
  }

  private async clearCurrent(): Promise<void> {
    this.toggleMenu(false);
    await this.history.clearCurrentSession();
    this.renderer.clearMessages();
    void this.updateTitle();
    this.pendingFiles = [];
    this.renderAttachPreview();
    // 清空后没有聊天记录了，角色解锁（按钮由 🔒 变回 ▾）
    this.syncRoleUI();
    this.syncReadyState();
    await this.renderer.renderMessage('当前会话已清空。', false, null, null, undefined, undefined, false);
  }

  // ---------- 插件管理面板（人工确认闸门） ----------

  /**
   * 列出全部工件，提供「查看完整源码 / 复制 / 启停 / 删除」。
   * 动态文本一律 textContent 构造 —— 插件名、id、源码都来自用户/LLM，绝不能拼进 innerHTML。
   */
  private async showPluginPanel(): Promise<void> {
    this.toggleMenu(false);
    // 每次重新打开面板都从干净状态开始，别把上次会话残留的定位目标带过来。
    this.pluginPanelFocus = undefined;
    // show() 是阻塞式 Promise（点关闭才 resolve），DOM 同步插入；
    // 先发起显示再填充内容，与 showHistory 同一套路。
    // 两个标签页共用同一个 dialog：本地工件 + 在线插件源。
    void this.dialog.show({
      type: 'custom',
      title: '插件管理',
      content:
        '<div class="plugin-panel" id="pluginPanelRoot">'
        + '<div class="plugin-panel__tabs" id="pluginPanelTabs">'
        + '<button type="button" class="plugin-panel__tab" data-tab="local">本地插件</button>'
        + '<button type="button" class="plugin-panel__tab" data-tab="online">在线插件</button>'
        + '</div>'
        + '<div class="plugin-panel__body" id="pluginPanelBody"></div>'
        + '</div>',
      buttons: [{ id: 'close', text: '关闭' }],
    });
    // show() 内部同步把 DOM 挂到 document.body，此处可直接绑定标签切换。
    document.getElementById('pluginPanelTabs')
      ?.querySelectorAll<HTMLButtonElement>('.plugin-panel__tab')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset['tab'];
          if (tab === 'local' || tab === 'online') {
            this.pluginPanelTab = tab;
            void this.refreshPluginPanel();
          }
        });
      });
    await this.refreshPluginPanel();
  }

  private async refreshPluginPanel(noStore = false): Promise<void> {
    const seq = ++this.pluginPanelSeq;
    const root = document.getElementById('pluginPanelRoot');
    const body = document.getElementById('pluginPanelBody');
    if (!root || !body) return;

    // 标签高亮与当前选择一致（切页/重开都同步）
    root.querySelectorAll<HTMLButtonElement>('.plugin-panel__tab').forEach((btn) => {
      btn.classList.toggle('plugin-panel__tab--active', btn.dataset['tab'] === this.pluginPanelTab);
    });
    if (this.pluginPanelTab === 'online') {
      await this.refreshOnlinePanel(body, seq, noStore);
      return;
    }

    body.replaceChildren();
    const plugin = this.plugin;
    if (!plugin) {
      body.appendChild(this.pluginPanelMessage('插件系统未就绪（当前只能自由聊天）。'));
      this.applyFlash(body);
      return;
    }

    let artifacts: PluginArtifact[];
    try {
      artifacts = await plugin.artifacts.list();
    } catch (error) {
      if (seq !== this.pluginPanelSeq || !root.isConnected) return;
      body.appendChild(this.pluginPanelMessage(
        `读取插件失败：${error instanceof Error ? error.message : String(error)}`,
      ));
      this.applyFlash(body);
      return;
    }
    // await 期间面板可能被关掉/重开：确认 root 仍挂载且是最新一次刷新
    if (seq !== this.pluginPanelSeq || !root.isConnected) return;
    if (document.getElementById('pluginPanelBody') !== body) return;

    if (artifacts.length === 0) {
      body.appendChild(this.pluginPanelMessage(
        '当前没有插件。切到「在线插件」标签可浏览并安装远程插件；或切到「插件开发」角色让智能体编写。',
      ));
      this.applyFlash(body);
      return;
    }
    for (const artifact of artifacts) {
      const card = this.buildPluginCard(artifact, plugin);
      card.dataset['panelKey'] = `local:${artifact.id}`;
      body.appendChild(card);
    }
    this.applyFlash(body);
  }

  /** 在线插件标签：当前源 + 插件列表。browse 走网络，用 seq 防竞态 */
  private async refreshOnlinePanel(body: HTMLElement, seq: number, noStore: boolean): Promise<void> {
    body.replaceChildren();
    const catalog = this.catalog;
    if (!catalog) {
      body.appendChild(this.pluginPanelMessage('插件系统未就绪，在线插件不可用。'));
      this.applyFlash(body);
      return;
    }
    body.appendChild(this.pluginPanelMessage('正在读取插件源…'));

    let result: CatalogBrowseResult;
    let source: CatalogSource;
    try {
      [result, source] = await Promise.all([catalog.browse(noStore), catalog.currentSource()]);
    } catch (error) {
      if (seq !== this.pluginPanelSeq || !body.isConnected) return;
      body.replaceChildren();
      body.appendChild(this.pluginPanelMessage(
        `读取插件源失败：${error instanceof Error ? error.message : String(error)}`,
      ));
      this.applyFlash(body);
      return;
    }
    if (seq !== this.pluginPanelSeq || !body.isConnected) return;
    if (document.getElementById('pluginPanelBody') !== body) return;

    body.replaceChildren();
    for (const failure of result.failures) {
      const tip = this.pluginPanelMessage(`源不可达：${failure.reason}`);
      tip.style.color = '#c23b3b';
      body.appendChild(tip);
    }
    body.appendChild(this.buildSourceManager(catalog, source));

    // 插件管理里只显示插件：type: tool 是声明镜像（执行器由宿主内置）。
    const plugins = result.entries.filter((e) => e.kind === 'plugin');
    if (plugins.length === 0) {
      body.appendChild(this.pluginPanelMessage(
        result.failures.length > 0
          ? '暂时没有可显示的插件。'
          : '当前源里没有插件。',
      ));
    } else {
      for (const entry of plugins) {
        const card = this.buildCatalogCard(entry, catalog);
        card.dataset['panelKey'] = `online:${entry.resourceId}`;
        body.appendChild(card);
      }
    }
    this.applyFlash(body);
    if (noStore) {
      body.prepend(this.pluginPanelMessage('已重新读取在线源（忽略浏览器缓存）'));
    }
  }

  /**
   * 当前源面板：默认只显示一行「当前源 + 地址」，点「修改」展开配置。
   * 单源模型：替换当前源 / 恢复官方默认，没有「添加源」、没有多源列表。
   */
  private buildSourceManager(catalog: PluginCatalogService, source: CatalogSource): HTMLElement {
    const box = document.createElement('div');
    box.className = 'plugin-panel__sources';

    const head = document.createElement('div');
    head.className = 'plugin-panel__sources-head';
    const info = document.createElement('span');
    info.className = 'plugin-panel__source-current';
    info.textContent = source.official ? `官方 · ${source.url}` : source.url;
    const editBtn = this.pluginAction('修改', () => {
      config.hidden = !config.hidden;
      editBtn.textContent = config.hidden ? '修改' : '收起';
      if (!config.hidden) input.focus();
    }, 'plugin-panel__primary');
    // 手动刷新放在「修改」右侧：重读在线源并绕过浏览器/CDN 的 HTTP 缓存。
    // 源面板只在「在线」标签渲染，天然只在该标签出现；body 每次 refresh 重建，
    // 「正在读取插件源…」那行已承担 loading 反馈，无需单独维护按钮禁用态。
    const refreshBtn = this.pluginAction('刷新', () => {
      void this.refreshPluginPanel(true);
    });
    refreshBtn.title = '忽略浏览器缓存，重新读取在线源';
    head.appendChild(info);
    head.appendChild(editBtn);
    head.appendChild(refreshBtn);
    box.appendChild(head);

    const config = document.createElement('div');
    config.className = 'plugin-panel__source-config';
    config.hidden = true;

    const row = document.createElement('div');
    row.className = 'plugin-panel__source-add';
    const input = document.createElement('input');
    input.type = 'url';
    input.value = source.url;
    input.className = 'plugin-panel__source-input';
    const saveBtn = this.pluginAction('保存', () => {
      const raw = input.value.trim();
      if (!raw) return;
      void (async () => {
        try {
          await catalog.setSource(raw);
          this.pluginPanelFlash = { text: '插件源已更新', error: false };
          await this.refreshPluginPanel();
        } catch (error) {
          this.showPluginError(`保存失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    }, 'plugin-panel__primary');
    row.appendChild(input);
    row.appendChild(saveBtn);
    config.appendChild(row);

    if (!source.official) {
      const resetBtn = this.pluginAction('恢复官方默认源', () => {
        void (async () => {
          try {
            await catalog.resetSource();
            this.pluginPanelFlash = { text: '已恢复官方默认源', error: false };
            await this.refreshPluginPanel();
          } catch (error) {
            this.showPluginError(`恢复失败：${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      });
      config.appendChild(resetBtn);
    }

    const hint = document.createElement('div');
    hint.className = 'plugin-panel__sources-hint';
    hint.textContent = '自定义源内容未经官方审核，安装前可查看源码；官方源由仓库 git 权限发布。';
    config.appendChild(hint);

    box.appendChild(config);
    return box;
  }

  /** 在线条目卡片。安装/更新按钮只在 new / update 时出现；tool 只展示 */
  private buildCatalogCard(entry: CatalogEntry, catalog: PluginCatalogService): HTMLElement {
    const card = document.createElement('div');
    card.className = 'plugin-panel__card';

    const head = document.createElement('div');
    head.className = 'plugin-panel__head';
    const name = document.createElement('span');
    name.className = 'plugin-panel__name';
    name.textContent = entry.name;
    const state = document.createElement('span');
    state.className = 'plugin-panel__state';
    const stateText: Record<CatalogEntry['state'], string> = {
      new: '未安装', update: '有更新', installed: '已安装',
      incompatible: '不兼容', unavailable: '不可用', 'tool-only': '仅声明',
    };
    state.textContent = stateText[entry.state];
    if (entry.state === 'installed' || entry.state === 'update') {
      state.classList.add('plugin-panel__state--on');
    }
    head.appendChild(name);
    head.appendChild(state);
    card.appendChild(head);

    const desc = document.createElement('div');
    desc.className = 'plugin-panel__intent';
    if (entry.reason !== undefined) {
      desc.textContent = entry.reason;
      desc.style.color = '#c23b3b';
    } else {
      desc.textContent = entry.summary;
    }
    if (entry.cached && desc.textContent !== '') {
      desc.textContent = `${desc.textContent}（离线缓存）`;
    }
    card.appendChild(desc);

    const actions = document.createElement('div');
    actions.className = 'plugin-panel__actions';

    // 远程源码与本地工件一样只用 textContent 展示，绝不拼进 innerHTML
    if (entry.kind === 'plugin' && entry.remoteCode !== undefined) {
      const viewBtn = this.pluginAction('查看源码', () => {
        const existing = card.querySelector('.plugin-panel__code');
        if (existing) {
          existing.remove();
          viewBtn.textContent = '查看源码';
          return;
        }
        const pre = document.createElement('pre');
        pre.className = 'plugin-panel__code';
        pre.textContent = entry.remoteCode ?? '';
        card.appendChild(pre);
        viewBtn.textContent = '收起源码';
      });
      actions.appendChild(viewBtn);
    }

    const installable = entry.kind === 'plugin'
      && (entry.state === 'new' || entry.state === 'update');
    if (installable) {
      const label = entry.state === 'update' ? '更新' : '安装';
      const btn = this.pluginAction(label, () => {
        void (async () => {
          btn.disabled = true;
          btn.textContent = '处理中…';
          try {
            const out = await catalog.install(entry);
            const text = out.warning === undefined
              ? out.message
              : `${out.message}（${out.warning}）`;
            this.pluginPanelFlash = { text, error: !out.ok };
            if (out.ok && out.action === 'installed' && out.artifact !== undefined) {
              // 新装工件由 install() 建为 enabled:false：切到「本地插件」并定位到它，
              // 同时给一条醒目提示，让用户明确「还需手动启用」，不能当成装完就生效。
              this.pluginPanelTab = 'local';
              this.pluginPanelFocus = {
                key: `local:${out.artifact.id}`,
                enableHint: true,
              };
            } else if (out.ok) {
              // 更新 / 无需变更仍停在在线页，定位回刚操作的这条。
              this.pluginPanelFocus = { key: `online:${entry.resourceId}` };
            }
            await this.refreshPluginPanel();
          } catch (error) {
            btn.disabled = false;
            btn.textContent = label;
            this.showPluginError(`操作失败：${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      }, 'plugin-panel__primary');
      actions.appendChild(btn);
    } else if (entry.kind === 'plugin') {
      const disabled = this.pluginAction(
        entry.state === 'installed' ? '已安装' : '不可安装',
        () => { /* 状态不允许安装 */ },
      );
      disabled.disabled = true;
      actions.appendChild(disabled);
    }
    // type: tool 的声明镜像不提供任何安装按钮
    card.appendChild(actions);
    return card;
  }

  /** 一次性操作反馈：随下一次面板渲染出现，随后清空 */
  private applyFlash(body: HTMLElement): void {
    const flash = this.pluginPanelFlash;
    this.pluginPanelFlash = undefined;
    if (flash !== undefined) {
      const tip = this.pluginPanelMessage(flash.text);
      if (flash.error) tip.style.color = '#c23b3b';
      body.prepend(tip);
    }
    // 跟着本次渲染一起消费定位目标（每条渲染完成路径都会走到这里）。
    const focus = this.pluginPanelFocus;
    this.pluginPanelFocus = undefined;
    if (focus !== undefined) this.applyPanelFocus(body, focus);
  }

  /**
   * 操作后定位回条目：按 data-panel-key 找到卡片、加高亮并滚到可见处。
   * 高亮保留到下一次刷新（DOM 重建自然清除），不设定时消失的魔法常数。
   * 新装插件（enableHint）另在列表顶部插一条醒目提示，明确「默认停用、需手动启用」。
   */
  private applyPanelFocus(body: HTMLElement, focus: PanelFocus): void {
    if (focus.enableHint === true) {
      const hint = document.createElement('div');
      hint.className = 'plugin-panel__enable-hint';
      hint.textContent = '⚠ 插件已安装，但默认停用、不会生效。请在下方高亮的「本地插件」条目点「启用」后才会运行。';
      body.prepend(hint);
    }
    let target: HTMLElement | undefined;
    body.querySelectorAll<HTMLElement>('.plugin-panel__card').forEach((card) => {
      if (target === undefined && card.dataset['panelKey'] === focus.key) target = card;
    });
    if (target === undefined) return; // 条目已被删掉：无可定位，静默跳过
    target.classList.add('plugin-panel__card--focus');
    // jsdom 等无布局环境不实现 scrollIntoView，调用前先探测，避免刷新逻辑被一个 TypeError 带崩。
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center' });
    }
  }

  private pluginPanelMessage(text: string): HTMLElement {
    const div = document.createElement('div');
    div.className = 'plugin-panel__empty';
    div.textContent = text;
    return div;
  }

  private pluginAction(label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (extraClass) btn.className = extraClass;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private buildPluginCard(artifact: PluginArtifact, plugin: PluginSystem): HTMLElement {
    const card = document.createElement('div');
    card.className = 'plugin-panel__card';

    const head = document.createElement('div');
    head.className = 'plugin-panel__head';
    const name = document.createElement('span');
    name.className = 'plugin-panel__name';
    name.textContent = artifact.name;
    const state = document.createElement('span');
    state.className = `plugin-panel__state${artifact.enabled ? ' plugin-panel__state--on' : ''}`;
    state.textContent = artifact.enabled ? '已启用' : '停用';
    head.appendChild(name);
    head.appendChild(state);
    card.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'plugin-panel__meta';
    meta.textContent = `${artifact.id} · ${artifact.pointId} · v${artifact.version} · ${this.formatTime(artifact.updatedAt)}`;
    card.appendChild(meta);

    const intent = document.createElement('div');
    intent.className = 'plugin-panel__intent';
    intent.textContent = artifact.intent;
    card.appendChild(intent);

    const actions = document.createElement('div');
    actions.className = 'plugin-panel__actions';

    const viewBtn = this.pluginAction('查看源码', () => {
      const existing = card.querySelector('.plugin-panel__code');
      if (existing) {
        existing.remove();
        viewBtn.textContent = '查看源码';
        return;
      }
      const pre = document.createElement('pre');
      pre.className = 'plugin-panel__code';
      pre.textContent = artifact.code; // 完整源码，textContent 防注入
      card.appendChild(pre);
      viewBtn.textContent = '收起源码';
    });
    actions.appendChild(viewBtn);

    const copyBtn = this.pluginAction('复制源码', () => void this.copyPluginText(artifact.code, copyBtn));
    actions.appendChild(copyBtn);

    const toggleBtn = this.pluginAction(artifact.enabled ? '停用' : '启用', () => {
      void (async () => {
        try {
          await plugin.artifacts.setEnabled(artifact.id, !artifact.enabled);
          // 刷新后面板会重建 DOM，定位回这个条目，别让用户从头找。
          this.pluginPanelFocus = { key: `local:${artifact.id}` };
          await this.refreshPluginPanel();
        } catch (error) {
          this.showPluginError(`操作失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    });
    actions.appendChild(toggleBtn);

    // 删除走内联二次确认：不嵌套 dialog（WebDialog 是单例）、不依赖 window.confirm
    actions.appendChild(this.pluginAction('删除', () => {
      actions.replaceChildren();
      const tip = document.createElement('span');
      tip.textContent = '确认删除该插件？';
      tip.style.cssText = 'color:#c23b3b;font-size:12px;align-self:center;';
      actions.appendChild(tip);
      actions.appendChild(this.pluginAction('确认删除', () => {
        void (async () => {
          try {
            await plugin.artifacts.remove(artifact.id);
            await this.refreshPluginPanel();
          } catch (error) {
            this.showPluginError(`删除失败：${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      }, 'plugin-panel__danger'));
      actions.appendChild(this.pluginAction('取消', () => void this.refreshPluginPanel()));
    }, 'plugin-panel__danger'));

    card.appendChild(actions);
    return card;
  }

  private async copyPluginText(text: string, btn: HTMLButtonElement): Promise<void> {
    const original = btn.textContent ?? '复制源码';
    const done = (): void => {
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = original; }, 2000);
    };
    try {
      await navigator.clipboard.writeText(text);
      done();
    } catch {
      // 非安全上下文 / WebView 兑底：textarea + execCommand
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); } catch { /* 克隆失败也给出反馈 */ }
      textarea.remove();
      done();
    }
  }

  private showPluginError(message: string): void {
    const body = document.getElementById('pluginPanelBody')
      ?? document.getElementById('pluginPanelRoot');
    if (!body) return;
    const tip = document.createElement('div');
    tip.className = 'plugin-panel__empty';
    tip.style.color = '#c23b3b';
    tip.textContent = message;
    body.prepend(tip);
    setTimeout(() => tip.remove(), 3000);
  }

  // ---------- 技能管理面板 ----------
  // 复用插件面板的 DOM helper（pluginAction / pluginPanelMessage 都是纯展示、无状态）
  // 与 plugin-panel__* CSS，避免两套样式。配方全部用 textContent，绝不拼 innerHTML。

  /** ⋮ →「🧠 技能」：两个标签共用同一个 dialog，默认「我的技能」 */
  private async showSkillPanel(): Promise<void> {
    this.toggleMenu(false);
    this.skillPanelFocus = undefined;
    void this.dialog.show({
      type: 'custom',
      title: '技能管理',
      content:
        '<div class="plugin-panel" id="skillPanelRoot">'
        + '<div class="plugin-panel__tabs" id="skillPanelTabs">'
        + '<button type="button" class="plugin-panel__tab" data-tab="local">我的技能</button>'
        + '<button type="button" class="plugin-panel__tab" data-tab="online">在线技能</button>'
        + '</div>'
        + '<div class="plugin-panel__body" id="skillPanelBody"></div>'
        + '</div>',
      buttons: [{ id: 'close', text: '关闭' }],
    });
    document.getElementById('skillPanelTabs')
      ?.querySelectorAll<HTMLButtonElement>('.plugin-panel__tab')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset['tab'];
          if (tab === 'local' || tab === 'online') {
            this.skillPanelTab = tab;
            void this.refreshSkillPanel();
          }
        });
      });
    await this.refreshSkillPanel();
  }

  private async refreshSkillPanel(noStore = false): Promise<void> {
    const seq = ++this.skillPanelSeq;
    const root = document.getElementById('skillPanelRoot');
    const body = document.getElementById('skillPanelBody');
    if (!root || !body) return;
    root.querySelectorAll<HTMLButtonElement>('.plugin-panel__tab').forEach((btn) => {
      btn.classList.toggle('plugin-panel__tab--active', btn.dataset['tab'] === this.skillPanelTab);
    });
    if (this.skillPanelTab === 'online') {
      await this.refreshSkillOnlinePanel(body, seq, noStore);
      return;
    }
    body.replaceChildren();
    const catalog = this.skillCatalog;
    if (!catalog) {
      body.appendChild(this.pluginPanelMessage('技能系统未就绪。'));
      this.applySkillFlash(body);
      return;
    }
    let entries: UserSkillEntry[];
    try {
      entries = await catalog.userStore().list();
    } catch (error) {
      if (seq !== this.skillPanelSeq || !root.isConnected) return;
      body.appendChild(this.pluginPanelMessage(
        `读取本地技能失败：${error instanceof Error ? error.message : String(error)}`,
      ));
      this.applySkillFlash(body);
      return;
    }
    if (seq !== this.skillPanelSeq || !root.isConnected) return;
    if (document.getElementById('skillPanelBody') !== body) return;
    if (entries.length === 0) {
      body.appendChild(this.pluginPanelMessage(
        '本地还没有技能。切到「在线技能」标签安装官方配方，或用「🧠 技能开发」角色让智能体自建。',
      ));
      this.applySkillFlash(body);
      return;
    }
    for (const entry of entries) {
      const card = this.buildUserSkillCard(entry, catalog);
      card.dataset['panelKey'] = `local:${entry.recipe.id}`;
      body.appendChild(card);
    }
    this.applySkillFlash(body);
  }

  /** 在线技能标签：当前源 + 逐条安装状态；browse 走网络，用 seq 防竞态 */
  private async refreshSkillOnlinePanel(body: HTMLElement, seq: number, noStore: boolean): Promise<void> {
    body.replaceChildren();
    const catalog = this.skillCatalog;
    if (!catalog) {
      body.appendChild(this.pluginPanelMessage('技能系统未就绪。'));
      this.applySkillFlash(body);
      return;
    }
    body.appendChild(this.pluginPanelMessage('正在读取技能源…'));
    let result: SkillCatalogBrowseResult;
    try {
      result = await catalog.browse(noStore);
    } catch (error) {
      if (seq !== this.skillPanelSeq || !body.isConnected) return;
      body.replaceChildren();
      body.appendChild(this.pluginPanelMessage(
        `读取技能源失败：${error instanceof Error ? error.message : String(error)}`,
      ));
      this.applySkillFlash(body);
      return;
    }
    if (seq !== this.skillPanelSeq || !body.isConnected) return;
    if (document.getElementById('skillPanelBody') !== body) return;

    body.replaceChildren();
    if (result.error !== undefined) {
      const tip = this.pluginPanelMessage(`源不可达：${result.error}`);
      tip.style.color = '#c23b3b';
      body.appendChild(tip);
    }
    body.appendChild(this.buildSkillSourceManager(catalog, result.source));
    if (result.items.length === 0) {
      body.appendChild(this.pluginPanelMessage(
        result.error !== undefined ? '暂时没有可显示的配方。' : '当前源里没有技能配方。',
      ));
    } else {
      for (const item of result.items) {
        const card = this.buildOnlineSkillCard(item, result.source, catalog);
        card.dataset['panelKey'] = `online:${item.recipe.id}`;
        body.appendChild(card);
      }
    }
    this.applySkillFlash(body);
    if (noStore) {
      body.prepend(this.pluginPanelMessage('已重新读取在线源（忽略浏览器缓存）'));
    }
  }

  /** 当前技能源面板：默认只显示一行，点「修改」展开配置（单源，可恢复官方默认） */
  private buildSkillSourceManager(catalog: SkillCatalogService, source: SkillSource): HTMLElement {
    const box = document.createElement('div');
    box.className = 'plugin-panel__sources';
    const head = document.createElement('div');
    head.className = 'plugin-panel__sources-head';
    const info = document.createElement('span');
    info.className = 'plugin-panel__source-current';
    info.textContent = source.official ? `官方 · ${source.url}` : source.url;
    const editBtn = this.pluginAction('修改', () => {
      config.hidden = !config.hidden;
      editBtn.textContent = config.hidden ? '修改' : '收起';
      if (!config.hidden) input.focus();
    }, 'plugin-panel__primary');
    // 手动刷新放在「修改」右侧，与插件源面板一致。
    const refreshBtn = this.pluginAction('刷新', () => {
      void this.refreshSkillPanel(true);
    });
    refreshBtn.title = '忽略浏览器缓存，重新读取在线源';
    head.append(info, editBtn, refreshBtn);
    box.appendChild(head);

    const config = document.createElement('div');
    config.className = 'plugin-panel__source-config';
    config.hidden = true;
    const row = document.createElement('div');
    row.className = 'plugin-panel__source-add';
    const input = document.createElement('input');
    input.type = 'url';
    input.value = source.url;
    input.className = 'plugin-panel__source-input';
    const saveBtn = this.pluginAction('保存', () => {
      const raw = input.value.trim();
      if (!raw) return;
      void (async () => {
        try {
          await catalog.setSource(raw);
          this.skillPanelFlash = { text: '技能源已更新', error: false };
          await this.refreshSkillPanel();
        } catch (error) {
          this.showSkillError(`保存失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    }, 'plugin-panel__primary');
    row.append(input, saveBtn);
    config.appendChild(row);
    if (!source.official) {
      config.appendChild(this.pluginAction('恢复官方默认源', () => {
        void (async () => {
          try {
            await catalog.resetSource();
            this.skillPanelFlash = { text: '已恢复官方默认源', error: false };
            await this.refreshSkillPanel();
          } catch (error) {
            this.showSkillError(`恢复失败：${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      }));
    }
    const hint = document.createElement('div');
    hint.className = 'plugin-panel__sources-hint';
    hint.textContent = '自定义源内容未经官方审核；技能配方只声明宿主已有的原语，绝不执行远程代码。';
    config.appendChild(hint);
    box.appendChild(config);
    return box;
  }

  /** 配方卡片共用部分：名称 / 状态 / 元信息 / 触发词 / 原语 / 摘要 */
  private buildSkillCardHead(recipe: SkillRecipe, state: { text: string; on: boolean }): HTMLElement {
    const card = document.createElement('div');
    card.className = 'plugin-panel__card';
    const head = document.createElement('div');
    head.className = 'plugin-panel__head';
    const name = document.createElement('span');
    name.className = 'plugin-panel__name';
    name.textContent = recipe.name;
    const badge = document.createElement('span');
    badge.className = `plugin-panel__state${state.on ? ' plugin-panel__state--on' : ''}`;
    badge.textContent = state.text;
    head.append(name, badge);
    card.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'plugin-panel__meta';
    meta.textContent = `${recipe.id} · v${recipe.version} · 原语：${recipe.primitives.join('、')}`;
    card.appendChild(meta);
    const intent = document.createElement('div');
    intent.className = 'plugin-panel__intent';
    intent.textContent = recipe.summary;
    card.appendChild(intent);
    return card;
  }

  /** 本地技能卡片（自建 + 已安装）：查看配方 / 启停 / 删除（内联二次确认） */
  private buildUserSkillCard(entry: UserSkillEntry, catalog: SkillCatalogService): HTMLElement {
    const recipe = entry.recipe;
    const unknown = recipe.primitives.filter((n) => !this.skillPrimitives?.has(n));
    const origin = entry.source === 'online' ? '在线安装' : '自建';
    const state = unknown.length > 0
      ? { text: `不可用（缺原语 ${unknown.join('、')}）`, on: false }
      : { text: `${origin} · ${entry.enabled ? '已启用' : '停用'}`, on: entry.enabled };
    const card = this.buildSkillCardHead(recipe, state);
    const actions = document.createElement('div');
    actions.className = 'plugin-panel__actions';

    actions.appendChild(this.pluginAction('查看配方', () => {
      const existing = card.querySelector('.plugin-panel__code');
      if (existing) {
        existing.remove();
        return;
      }
      const pre = document.createElement('pre');
      pre.className = 'plugin-panel__code';
      pre.textContent = JSON.stringify(recipe, null, 2);
      card.appendChild(pre);
    }));

    actions.appendChild(this.pluginAction(entry.enabled ? '停用' : '启用', () => {
      void (async () => {
        try {
          await catalog.userStore().setEnabled(recipe.id, !entry.enabled);
          // 刷新后定位回这个条目，别让用户从头找。
          this.skillPanelFocus = { key: `local:${recipe.id}` };
          await this.refreshSkillPanel();
        } catch (error) {
          this.showSkillError(`操作失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    }));

    actions.appendChild(this.pluginAction('删除', () => {
      actions.replaceChildren();
      const tip = document.createElement('span');
      tip.textContent = '确认删除这条本地技能？';
      tip.style.cssText = 'color:#c23b3b;font-size:12px;align-self:center;';
      actions.appendChild(tip);
      actions.appendChild(this.pluginAction('确认删除', () => {
        void (async () => {
          try {
            await catalog.userStore().remove(recipe.id);
            this.skillPanelFlash = { text: '已删除本地技能', error: false };
            await this.refreshSkillPanel();
          } catch (error) {
            this.showSkillError(`删除失败：${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      }, 'plugin-panel__danger'));
      actions.appendChild(this.pluginAction('取消', () => void this.refreshSkillPanel()));
    }, 'plugin-panel__danger'));

    card.appendChild(actions);
    return card;
  }

  /**
   * 在线源里的配方：状态来自 browse()（已装 / 有更新 / 未安装 / 缺原语不可用）。
   * 安装 / 更新写进本地库后刷新面板；「我的技能」与对话才会看到它。
   */
  private buildOnlineSkillCard(
    item: SkillBrowseItem, source: SkillSource, catalog: SkillCatalogService,
  ): HTMLElement {
    const recipe = item.recipe;
    const origin = source.official ? '官方源' : '自定义源';
    const stateText: Record<SkillBrowseItem['state'], string> = {
      new: `未安装 · ${origin}`,
      installed: `已安装 · ${origin}`,
      update: `有更新 · ${origin}`,
      unavailable: item.reason ?? '不可用',
    };
    const state = {
      text: stateText[item.state],
      on: item.state === 'installed' || item.state === 'update',
    };
    const card = this.buildSkillCardHead(recipe, state);
    const actions = document.createElement('div');
    actions.className = 'plugin-panel__actions';
    actions.appendChild(this.pluginAction('查看配方', () => {
      const existing = card.querySelector('.plugin-panel__code');
      if (existing) {
        existing.remove();
        return;
      }
      const pre = document.createElement('pre');
      pre.className = 'plugin-panel__code';
      pre.textContent = JSON.stringify(recipe, null, 2);
      card.appendChild(pre);
    }));
    if (item.state === 'new' || item.state === 'update') {
      actions.appendChild(this.pluginAction(item.state === 'update' ? '更新' : '安装', () => {
        void (async () => {
          const out = await catalog.install(recipe);
          this.skillPanelFlash = { text: out.message, error: !out.ok };
          if (out.ok) {
            // 技能安装即刻生效、不需要手动启用提示；仅定位回刚操作的条目。
            this.skillPanelFocus = { key: `online:${recipe.id}` };
          }
          await this.refreshSkillPanel();
        })();
      }, 'plugin-panel__primary'));
    } else if (item.state === 'installed') {
      const done = this.pluginAction('已安装', () => { /* 本地已有，无需再装 */ });
      done.disabled = true;
      actions.appendChild(done);
    }
    // unavailable：只展示原因，不给安装按钮
    card.appendChild(actions);
    return card;
  }

  private applySkillFlash(body: HTMLElement): void {
    const flash = this.skillPanelFlash;
    this.skillPanelFlash = undefined;
    if (flash !== undefined) {
      const tip = this.pluginPanelMessage(flash.text);
      if (flash.error) tip.style.color = '#c23b3b';
      body.prepend(tip);
    }
    const focus = this.skillPanelFocus;
    this.skillPanelFocus = undefined;
    if (focus !== undefined) this.applyPanelFocus(body, focus);
  }

  private showSkillError(message: string): void {
    const body = document.getElementById('skillPanelBody')
      ?? document.getElementById('skillPanelRoot');
    if (!body) return;
    const tip = document.createElement('div');
    tip.className = 'plugin-panel__empty';
    tip.style.color = '#c23b3b';
    tip.textContent = message;
    body.prepend(tip);
    setTimeout(() => tip.remove(), 3000);
  }

  // ---------- 工具 ----------

  private formatTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private escapeHtml(raw: string): string {
    return raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}
