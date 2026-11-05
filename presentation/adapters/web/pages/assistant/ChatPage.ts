/**
 * AI 对话页面编排
 * @module presentation/adapters/web/pages/assistant/ChatPage
 *
 * 独立页面 assistant/chat.html 的控制器。复用功能助手的渲染器、会话存储、
 * 凭据、文件导出器与共享 CSS，但不引入意图识别、命令体系、任务桥接。
 *
 * 右上角菜单仅四项：新建会话 / 历史会话 / 导出会话 / 清空会话，
 * 全部作用于「当前会话」或 chat 页自己的会话集合（独立 category 隔离）。
 */

import { AssistantRenderer } from './AssistantRenderer';
import { ChatHistoryManager, type ChatMessage, type ChatSession } from '../../../../../application/assistant/ChatHistoryManager';
import { FavoriteService } from '../../../../../services/favorite/FavoriteService';
import { IndexedDBAdapter } from '../../../../../infrastructure/storage/adapters/web/IndexedDBAdapter';
import { WebFileExporter } from '../../../../../infrastructure/utils/export/WebFileExporter';
import { WebDialog } from '../../components/Dialog';
import { OpenAIModelGateway } from '../../../../../infrastructure/llm/OpenAIModelGateway';
import { ChatUseCase } from '../../../../../application/chat/ChatUseCase';

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

  async init(): Promise<void> {
    const storage = new IndexedDBAdapter<{ id: string; category: string; key: string; createdAt: number }>(
      DB_NAME, DB_STORE,
    );
    await storage.initialize();
    this.history = new ChatHistoryManager(new FavoriteService(storage), CHAT_CATEGORY);
    this.useCase = new ChatUseCase(new OpenAIModelGateway(), this.history, this.renderer);

    this.bindUI();
    this.syncReadyState();
    await this.restoreLastSession();
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

    // 菜单四项 + 遮罩关闭
    document.getElementById('menuBtn')?.addEventListener('click', () => this.toggleMenu());
    document.getElementById('menuOverlay')?.addEventListener('click', () => this.toggleMenu(false));
    document.getElementById('miNew')?.addEventListener('click', () => void this.newSession());
    document.getElementById('miHistory')?.addEventListener('click', () => void this.showHistory());
    document.getElementById('miExport')?.addEventListener('click', () => void this.exportCurrent());
    document.getElementById('miClear')?.addEventListener('click', () => void this.clearCurrent());
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
