/**
 * AI 对话页面编排
 * @module presentation/adapters/web/pages/assistant/ChatPage
 *
 * 独立页面 assistant/chat.html 的控制器，也是「智能体主控台」：
 * 复用功能助手的渲染器、会话存储、凭据与共享 CSS，不引入旧意图/命令体系；
 * 可编程（编写/修改插件）是一等能力，由 PluginSystem 装配进 ChatUseCase。
 *
 * 插件数据来自独立工件存储，不来自会话历史 —— 新会话、老会话、会话清空后
 * LLM 都能看到并修改插件。装配失败时自动降级为纯聊天，页面始终可用。
 *
 * 右上角菜单五项：新建会话 / 历史会话 / 导出会话 / 清空会话 / 插件。
 * 「插件」是人工确认闸门：查看完整源码、复制、启停、删除都由用户显式操作。
 */

import { AssistantRenderer } from './AssistantRenderer';
import { ChatHistoryManager, type ChatMessage, type ChatSession } from '../../../../../application/assistant/ChatHistoryManager';
import { FavoriteService } from '../../../../../services/favorite/FavoriteService';
import { IndexedDBAdapter } from '../../../../../infrastructure/storage/adapters/web/IndexedDBAdapter';
import { WebFileExporter } from '../../../../../infrastructure/utils/export/WebFileExporter';
import { WebDialog } from '../../components/Dialog';
import { ChatUseCase } from '../../../../../application/chat/ChatUseCase';
import { OpenAIModelGateway } from '../../../../../infrastructure/llm/OpenAIModelGateway';
import { createPluginSystem, type PluginSystem } from '../../../../../application/plugin/PluginSystem';
import type { PluginArtifact } from '../../../../../domain/plugin/types';

/** 与功能助手 'chat-session' 隔离，导出/清空天然只覆盖对话页会话 */
const CHAT_CATEGORY = 'chat-conversation';
const LAST_SESSION_KEY = 'chat:lastSessionId';
const DB_NAME = 'weiqi-assistant';
const DB_STORE = 'favorites';

export class ChatPage {
  private readonly renderer = new AssistantRenderer();
  private readonly dialog = new WebDialog();
  private readonly exporter = new WebFileExporter();
  private history!: ChatHistoryManager;
  private useCase!: ChatUseCase;
  private plugin: PluginSystem | undefined;
  /** 面板刷新序号：异步 list() 期间用户可能关掉/重开面板，旧结果必须丢弃 */
  private pluginPanelSeq = 0;

  async init(): Promise<void> {
    const storage = new IndexedDBAdapter<{ id: string; category: string; key: string; createdAt: number }>(
      DB_NAME, DB_STORE,
    );
    await storage.initialize();
    this.history = new ChatHistoryManager(new FavoriteService(storage), CHAT_CATEGORY);

    // 先装配插件系统，再决定 ChatUseCase 是「智能体」还是「纯聊天」。
    // 任何装配异常都不阻塞对话页：降级为纯聊天是设计内的兜底，不是错误吞掉。
    try {
      this.plugin = await createPluginSystem();
    } catch {
      this.plugin = undefined;
    }
    this.useCase = new ChatUseCase(
      this.plugin?.gateway ?? new OpenAIModelGateway(),
      this.history,
      this.renderer,
      this.plugin
        ? { turn: (req) => this.plugin!.agent.turn(req), safeReply: (t) => this.plugin!.safeReply(t) }
        : undefined,
    );

    this.bindUI();
    this.bindLifecycle();
    this.syncReadyState();
    await this.restoreLastSession();
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
      input.placeholder = ready ? '继续对话…' : '请先到功能助手配置 LLM';
    }
    if (sendBtn) sendBtn.disabled = !ready;
    if (banner) banner.style.display = ready ? 'none' : 'block';
  }

  private async handleSend(): Promise<void> {
    const input = document.getElementById('userInput') as HTMLTextAreaElement | null;
    if (!input || input.disabled) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    this.autoResize(input);
    await this.useCase.send(text);
  }

  // ---------- 会话管理 ----------

  private async restoreLastSession(): Promise<void> {
    const lastId = localStorage.getItem(LAST_SESSION_KEY);
    if (lastId) {
      const messages = await this.history.loadSession(lastId);
      if (messages) {
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
        await this.renderSession(messages);
        return;
      }
    }
    await this.newSession(false);
  }

  private async renderSession(messages: ChatMessage[]): Promise<void> {
    this.renderer.clearMessages();
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    for (const msg of sorted) {
      // 历史恢复不用打字机，避免刷新后逐字动画
      await this.renderer.renderMessage(
        msg.content, msg.role === 'user', null, null,
        undefined, undefined, false, undefined, msg.timestamp,
      );
    }
    this.updateTitle();
    this.scrollToBottom();
  }

  private async newSession(clearUI = true): Promise<void> {
    const id = await this.history.createSession('新对话');
    localStorage.setItem(LAST_SESSION_KEY, id);
    if (clearUI) {
      this.renderer.clearMessages();
      this.updateTitle();
    }
    this.toggleMenu(false);
    this.syncReadyState();
  }

  private updateTitle(): void {
    const el = document.getElementById('chatTitle');
    if (!el) return;
    const meta = this.history.getCurrentSession();
    el.textContent = meta ? this.sessionTitle(meta) : '新对话';
  }

  /** 会话标题 = 第一条 user 消息截断（用户确认的「聊天摘要」口径） */
  private sessionTitle(meta: { sessionId: string; messages: ChatMessage[] }): string {
    const first = meta.messages.find((m) => m.role === 'user');
    if (!first) return '新对话';
    const flat = first.content.replace(/\s+/g, ' ').trim();
    if (!flat) return '新对话';
    return flat.length > 30 ? flat.slice(0, 30) + '...' : flat;
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
        return `<div class="session-card${active}" data-session-id="${this.escapeHtml(s.sessionId)}">
          <div class="session-card__time">${time}</div>
          <div class="session-card__summary">${summary}</div>
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
      card.addEventListener('click', async () => {
        this.dialog.close();
        const id = card.getAttribute('data-session-id');
        if (!id) return;
        const messages = await this.history.loadSession(id);
        if (!messages) return;
        localStorage.setItem(LAST_SESSION_KEY, id);
        await this.renderSession(messages);
        this.syncReadyState();
      });
    });
  }

  private sessionTitleFromSession(s: ChatSession): string {
    return this.sessionTitle({ sessionId: s.sessionId, messages: s.data.messages ?? [] });
  }

  // ---------- 导出 / 清空（仅当前会话） ----------

  private async exportCurrent(): Promise<void> {
    this.toggleMenu(false);
    const meta = this.history.getCurrentSession();
    if (!meta || meta.messages.length === 0) {
      await this.renderer.renderMessage('当前会话暂无消息可导出。', false, null, null, undefined, undefined, false);
      return;
    }
    const filename = `weiqi-chat-${new Date().toISOString().slice(0, 10)}.json`;
    const result = await this.exporter.exportJSON(
      {
        sessionId: meta.sessionId,
        title: this.sessionTitle(meta),
        messages: meta.messages,
      },
      filename,
    );
    await this.renderer.renderMessage(
      result.success ? `已导出当前会话（${meta.messages.length} 条消息）` : `导出失败：${result.error ?? '未知错误'}`,
      false, null, null, undefined, undefined, false,
    );
  }

  private async clearCurrent(): Promise<void> {
    this.toggleMenu(false);
    await this.history.clearCurrentSession();
    this.renderer.clearMessages();
    this.updateTitle();
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
    // show() 是阻塞式 Promise（点关闭才 resolve），DOM 同步插入；
    // 先发起显示再填充内容，与 showHistory 同一套路。
    void this.dialog.show({
      type: 'custom',
      title: '插件管理',
      content: '<div class="plugin-panel" id="pluginPanelRoot"></div>',
      buttons: [{ id: 'close', text: '关闭' }],
    });
    await this.refreshPluginPanel();
  }

  private async refreshPluginPanel(): Promise<void> {
    const seq = ++this.pluginPanelSeq;
    const root = document.getElementById('pluginPanelRoot');
    if (!root) return;
    root.replaceChildren();

    const plugin = this.plugin;
    if (!plugin) {
      root.appendChild(this.pluginPanelMessage('插件系统未就绪（当前为纯聊天模式）。'));
      return;
    }

    let artifacts: PluginArtifact[];
    try {
      artifacts = await plugin.artifacts.list();
    } catch (error) {
      if (seq !== this.pluginPanelSeq || !root.isConnected) return;
      root.appendChild(this.pluginPanelMessage(
        `读取插件失败：${error instanceof Error ? error.message : String(error)}`,
      ));
      return;
    }
    // await 期间面板可能被关掉/重开：确认 root 仍挂载且是最新一次刷新
    if (seq !== this.pluginPanelSeq || !root.isConnected) return;
    if (document.getElementById('pluginPanelRoot') !== root) return;

    if (artifacts.length === 0) {
      root.appendChild(this.pluginPanelMessage(
        '当前没有插件。可以在对话里让模型编写，生成候选后在这里确认启用。',
      ));
      return;
    }
    for (const artifact of artifacts) {
      root.appendChild(this.buildPluginCard(artifact, plugin));
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
    const root = document.getElementById('pluginPanelRoot');
    if (!root) return;
    const tip = document.createElement('div');
    tip.className = 'plugin-panel__empty';
    tip.style.color = '#c23b3b';
    tip.textContent = message;
    root.prepend(tip);
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
