/**
 * 棋谱下载页面渲染器
 * @module presentation/pages/fetcher/FetcherRenderer
 */
import type { ITabs, ICard, IInput, IButton, IPanel, IToast, IOverlay, ISelect, IAdapterFactory } from '../../../../core/interfaces';
import type { FetcherResult, FetcherBookmark, ShareResult, LatestGameItem } from '../../../../../application/fetcher';
import type { FetcherFormatter } from './FetcherFormatter';
import { WebOverlay } from '../../components/Overlay';
import { WebQRCodeDialog } from '../../components/QRCodeDialog';
/** 渲染器回调 */
export interface FetcherRendererCallbacks {
  onFetch: (url: string) => Promise<void>;
  onViewBookmark: (id: string) => Promise<void>;
  onClearBookmarks: () => Promise<void>;
  onDownload: () => Promise<void>;
  onViewSGF: () => Promise<void>;
  onGenerateShareUrl: () => Promise<void>;
  onFetchLatest: (source: string, count: number) => Promise<void>;
  onSelectLatest: (url: string) => void;
}
export class FetcherRenderer {
  readonly tabs: ITabs;
  readonly queryPanel: IPanel;
  readonly bookmarkPanel: IPanel;
  readonly input: IInput;
  readonly fetchBtn: IButton;
  readonly bookmarkCard: ICard;
  readonly resultCard: ICard;
  readonly toast: IToast;
  readonly latestPanel: IPanel;
  readonly sourceSelect: ISelect;
  readonly countSelect: ISelect;
  readonly latestCard: ICard;
  private overlay: IOverlay;
  private qrDialog: WebQRCodeDialog;
  private hasResult = false;
  private _currentResult: FetcherResult | undefined;
  constructor(
    private readonly cb: FetcherRendererCallbacks,
    private readonly factory: IAdapterFactory,
    private readonly formatter: FetcherFormatter,
  ) {
    this.tabs = factory.createTabs();
    this.queryPanel = factory.createPanel();
    this.bookmarkPanel = factory.createPanel();
    const qc = this.queryPanel.asContainer();
    this.input = factory.createInput(qc);
    this.fetchBtn = factory.createButton(qc);
    const rc = this.bookmarkPanel.asContainer();
    this.bookmarkCard = factory.createCard(rc);
    this.resultCard = factory.createCard(qc);
    this.toast = factory.createToast();
    this.latestPanel = factory.createPanel();
    const lc = this.latestPanel.asContainer();
    this.sourceSelect = factory.createSelect(lc);
    this.countSelect = factory.createSelect(lc);
    this.latestCard = factory.createCard(lc);
    this.overlay = new WebOverlay();
    this.qrDialog = new WebQRCodeDialog({ title: '扫码下载棋谱', hint: '截图或长按二维码识别后即可下载SGF文件' });
  }
  initialize(): void {
    this.tabs.setConfig({
      items: [
        { id: 'query', label: '🔍 抓取' },
        { id: 'latest', label: '📰 最新' },
        { id: 'bookmarks', label: '⭐ 收藏' },
      ],
      activeId: 'query',
    });
    this.tabs.onChange((id) => {
      this.queryPanel.setVisible(id === 'query');
      this.latestPanel.setVisible(id === 'latest');
      this.bookmarkPanel.setVisible(id === 'bookmarks');
      this.resultCard.setVisible(id === 'query' && this.hasResult);
    });
    this.queryPanel.setTitle('📋 分享链接');
    this.input.setConfig({ type: 'textarea', placeholder: '支持：野狐、弈城、OGS、101围棋、弈客、元萝卜、腾讯围棋等平台...', clearable: true });
    this.input.onEnter((url) => { if (url.trim()) this.cb.onFetch(url.trim()); });
    this.fetchBtn.setText('🔍 抓取棋谱');
    this.fetchBtn.onClick(() => { const url = this.input.getValue().trim(); if (url) this.cb.onFetch(url); });
    this.bookmarkPanel.setTitle('⭐ 我的收藏');
    if (this.bookmarkPanel.addAction) this.bookmarkPanel.addAction('🗑️ 清空', 'clearBookmarks');
    this.bookmarkPanel.onAction((action) => { if (action === 'clearBookmarks') this.cb.onClearBookmarks(); });
    // 最新标签页
    this.latestPanel.setTitle('📰 最新棋谱');
    this.sourceSelect.setConfig({
      options: [
        { value: 'foxwq', label: '野狐围棋' },
        { value: 'weiqi101', label: '101围棋' },
      ],
      value: 'foxwq',
    });
    this.countSelect.setConfig({
      options: [
        { value: '10', label: '10 盘' },
        { value: '20', label: '20 盘' },
        { value: '30', label: '30 盘' },
        { value: '50', label: '50 盘' },
      ],
      value: '20',
    });
    this.bookmarkPanel.setVisible(false);
    this.latestPanel.setVisible(false);
    this.resultCard.setVisible(false);
    this.overlay.hide();
  }
  bindActions(): void {
    this.bookmarkCard.onAction((action, data) => { if (action === 'viewBookmark' && data?.['id']) this.cb.onViewBookmark(data['id']); });
    this.resultCard.onAction((action) => {
      if (action === "live") {
        if (this._currentResult) {
          this.cb.onViewSGF();
        }
      } else if (action === "download") {
        this.cb.onDownload();
      } else if (action === "view") {
        this.cb.onViewSGF();
      } else if (action === "share") {
        this.cb.onGenerateShareUrl();
      }
    });
  }
  switchToQueryTab(): void {
    this.tabs.setActiveId('query');
    this.queryPanel.setVisible(true);
    this.latestPanel.setVisible(false);
    this.bookmarkPanel.setVisible(false);
    this.resultCard.setVisible(this.hasResult);
  }
  setInputValue(value: string): void { this.input.setValue(value); }
  showClipboardHint(): void {
    const container = this.queryPanel.asContainer() as HTMLElement;
    const existing = container.querySelector('.clipboard-hint');
    if (existing) existing.remove();
    const hint = document.createElement('div');
    hint.className = 'clipboard-hint';
    hint.style.cssText = 'font-size:12px;color:#38a169;margin-top:8px;display:flex;align-items:center;gap:4px;';
    hint.innerHTML = '<span>✓</span><span>已自动填入剪贴板内容</span>';
    const inputContainer = this.input.getContainer();
    if (inputContainer?.nextSibling) container.insertBefore(hint, inputContainer.nextSibling);
    else container.appendChild(hint);
  }
  showLoading(show: boolean, message?: string): void {
    if (show) {
      this.fetchBtn.setLoading(true);
      this.input.setDisabled(true);
      this.resultCard.setTitle('⏳ 抓取中');
      this.resultCard.setContent(this.formatter.formatLoading(message));
      this.resultCard.setVisible(true);
      this.resultCard.render();
    } else {
      this.fetchBtn.setLoading(false);
      this.fetchBtn.setText('🔍 抓取棋谱');
      this.input.setDisabled(false);
    }
  }
  showError(title: string, message: string): string {
    this.resultCard.setTitle('❌ 抓取失败');
    this.resultCard.setContent(this.formatter.formatError(title, message));
    this.resultCard.setVisible(true);
    this.resultCard.render();
    return this.formatter.formatError(title, message);
  }
  showResult(result: FetcherResult, isLive: boolean = false): void {
    this.hasResult = true;
    this._currentResult = result;
    this.resultCard.setTitle('📄 棋谱信息');
    this.resultCard.setContent(this.formatter.formatResultInfo(result, isLive));
    this.resultCard.setVisible(true);
    this.resultCard.render();
  }
  getCurrentResult(): FetcherResult | undefined { return this._currentResult; }
  setCurrentResult(result: FetcherResult): void { this._currentResult = result; }
  renderBookmarks(entries: FetcherBookmark[]): void {
    if (entries.length === 0) {
      this.bookmarkCard.setContent(this.formatter.formatEmptyState());
    } else {
      const items = entries.slice(0, 20).map((e) => this.formatter.formatBookmarkItem(e));
      this.bookmarkCard.setContent(items.join('\n'));
    }
    this.bookmarkCard.render();
  }
  async showQRCodeDialog(result: ShareResult): Promise<void> {
    if (result.success && result.shareUrl) await this.qrDialog.show(result.shareUrl);
  }
  render(): void {
    this.tabs.render();
    this.queryPanel.render();
    this.latestPanel.render();
    this.bookmarkPanel.render();
    this.resultCard.render();
  }
  /**
   * 绑定最新标签页的刷新按钮
   */
  bindLatestActions(): void {
    // 刷新按钮
    if (this.latestPanel.addAction) {
      this.latestPanel.addAction('🔄 刷新', 'refreshLatest');
    }
    this.latestPanel.onAction((action) => {
      if (action === 'refreshLatest') {
        const source = this.sourceSelect.getValue() || 'foxwq';
        const count = parseInt(this.countSelect.getValue() || '20', 10);
        this.cb.onFetchLatest(source, count);
      }
    });
    // 下拉框变化时自动刷新
    this.sourceSelect.onChange(() => {
      const source = this.sourceSelect.getValue() || 'foxwq';
      const count = parseInt(this.countSelect.getValue() || '20', 10);
      this.cb.onFetchLatest(source, count);
    });
    this.countSelect.onChange(() => {
      const source = this.sourceSelect.getValue() || 'foxwq';
      const count = parseInt(this.countSelect.getValue() || '20', 10);
      this.cb.onFetchLatest(source, count);
    });
    // 卡片点击
    this.latestCard.onAction((action, data) => {
      if (action === 'selectLatest' && data?.['url']) {
        this.cb.onSelectLatest(data['url'] as string);
      }
    });
  }

  /**
   * 渲染最新棋谱列表
   */
  renderLatestGames(items: LatestGameItem[]): void {
    if (items.length === 0) {
      this.latestCard.setVisible(false);
      this.latestCard.render();
      return;
    }
    this.latestCard.setVisible(true);
    const html = items.map(item => {
      const sourceLabel = item.source === 'foxwq' ? '🏆 野狐' : '📝 101围棋';
      const subtitle = item.subtitle
        ? `<div style="font-size:0.85em;color:#666;margin-top:4px;">${item.subtitle}</div>`
        : '';
      return `<div data-action="selectLatest" data-url="${item.url}" style="padding:10px 0;border-top:1px solid #eee;cursor:pointer;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background=''">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:0.8em;font-weight:500;color:#667eea;">${sourceLabel}</span>
          <span style="font-size:0.8em;color:#888;">${item.date}</span>
        </div>
        <div style="font-weight:500;color:#333;font-size:0.95em;">${item.title}</div>
        ${subtitle}
      </div>`;
    }).join('');
    this.latestCard.setContent(html);
    this.latestCard.render();
  }

  /**
   * 显示最新列表加载状态
   */
  showLatestLoading(show: boolean): void {
    if (show) {
      this.latestCard.setTitle('⏳ 加载中...');
      this.latestCard.setContent('<div style="text-align:center;padding:30px;"><div style="width:30px;height:30px;border:3px solid #e0e0e0;border-top-color:#667eea;border-radius:50%;margin:0 auto 8px;animation:fetcher-spin 1s linear infinite;"></div><p style="color:#888;font-size:0.9em;">正在获取棋谱列表...</p></div>');
      this.latestCard.render();
    } else {
      this.latestCard.setTitle('📰 最新棋谱');
    }
  }

  destroy(): void {
    this.tabs.destroy();
    this.queryPanel.destroy();
    this.latestPanel.destroy();
    this.bookmarkPanel.destroy();
    this.resultCard.destroy();
    this.toast.destroy();
    this.overlay.destroy();
    this.qrDialog.destroy();
    this.hasResult = false;
    this._currentResult = undefined;
  }
}