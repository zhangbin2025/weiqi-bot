/**
 * 棋谱下载页面渲染器
 * @module presentation/pages/fetcher/FetcherRenderer
 */
import type { ITabs, ICard, IInput, IButton, IPanel, IToast, IOverlay, IAdapterFactory } from '../../../../core/interfaces';
import type { FetcherResult, FetcherBookmark, ShareResult } from '../../../../../application/fetcher';
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
    this.overlay = new WebOverlay();
    this.qrDialog = new WebQRCodeDialog({ title: '扫码下载棋谱', hint: '截图或长按二维码识别后即可下载SGF文件' });
  }
  initialize(): void {
    this.tabs.setConfig({
      items: [{ id: 'query', label: '🔍 抓取' }, { id: 'bookmarks', label: '⭐ 收藏' }],
      activeId: 'query',
    });
    this.tabs.onChange((id) => {
      this.queryPanel.setVisible(id === 'query');
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
    this.bookmarkPanel.setVisible(false);
    this.resultCard.setVisible(false);
    this.overlay.hide();
  }
  bindActions(): void {
    this.bookmarkCard.onAction((action, data) => { if (action === 'viewBookmark' && data?.['id']) this.cb.onViewBookmark(data['id']); });
    this.resultCard.onAction((action) => {
      if (action === 'download') this.cb.onDownload();
      else if (action === 'view') this.cb.onViewSGF();
      else if (action === 'share') this.cb.onGenerateShareUrl();
    });
  }
  switchToQueryTab(): void {
    this.tabs.setActiveId('query');
    this.queryPanel.setVisible(true);
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
  showResult(result: FetcherResult): void {
    this.hasResult = true;
    this._currentResult = result;
    this.resultCard.setTitle('📄 棋谱信息');
    this.resultCard.setContent(this.formatter.formatResultInfo(result));
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
    this.bookmarkPanel.render();
    this.resultCard.render();
  }
  destroy(): void {
    this.tabs.destroy();
    this.queryPanel.destroy();
    this.bookmarkPanel.destroy();
    this.resultCard.destroy();
    this.toast.destroy();
    this.overlay.destroy();
    this.qrDialog.destroy();
    this.hasResult = false;
    this._currentResult = undefined;
  }
}