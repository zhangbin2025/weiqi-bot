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
  onLive: () => void;
  onGenerateShareUrl: () => Promise<void>;
  onSelectLatestView: (url: string) => void;
  /** 拉取最新列表（数量由渲染器统一控制为 LATEST_FETCH_MAX 池子大小） */
  onFetchLatest: (source: string, keyword?: string) => Promise<void>;
  onSelectLatest: (url: string) => void;
  onViewUrl: (url: string) => void;
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
  readonly categorySelect: ISelect;
  readonly sourceSelect: ISelect;
  readonly keywordInput: IInput;
  readonly latestCard: ICard;
  private overlay: IOverlay;
  private qrDialog: WebQRCodeDialog;
  // —— 最新列表分页（本地切片）常量 ——
  /** 初始展示条数 */
  static readonly LATEST_PAGE_INIT = 10;
  /** 每次加载更多追加的条数 */
  static readonly LATEST_PAGE_STEP = 10;
  /** 底层一次拉取的最大条数（本地切片的总池子） */
  static readonly LATEST_FETCH_MAX = 100;
  /** 滑到底后模拟异步刷新的延迟（ms），给用户"加载中"的体感 */
  static readonly LATEST_LOAD_DELAY = 450;

  private hasResult = false;
  private _latestItems: LatestGameItem[] = [];
  /** 当前已展示的最新棋谱条数（初始 10，滑到底 +10） */
  private _displayedLatest = FetcherRenderer.LATEST_PAGE_INIT;
  private _selectedLatestUrl: string | null = null;
  /** 加载更多时的底部哨兵节点（用于移除/复用） */
  private _loadMoreSentinel: HTMLElement | null = null;
  private _io: IntersectionObserver | null = null;
  /** 是否正在加载下一页（加锁防止 IntersectionObserver 连发瞬间爆开） */
  private _loadingMore = false;
  private _loadMoreTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.categorySelect = factory.createSelect(lc);
    this.sourceSelect = factory.createSelect(lc);
    this.keywordInput = factory.createInput(lc);
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
      // 切到最新标签页时，滚动到选中条目
      if (id === 'latest' && this._selectedLatestUrl) {
        setTimeout(() => {
          const el = this.latestCard.getContainer?.() as HTMLElement | undefined;
          if (!el) return;
        const sel = '[data-url="' + (this._selectedLatestUrl || '').replace(/"/g, '\\"') + '"]';
          const target = el.querySelector(sel) as HTMLElement | null;
          target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
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
    // 分类筛选
    this.categorySelect.setConfig({
      options: [
        { value: 'archive', label: '📠 归档' },
        { value: 'puzzle', label: '🧩 做题' },
        { value: 'live', label: '📺 直播' },
      ],
      value: 'archive',
    });
    this.updateSourceOptions('archive');
    this.keywordInput.setConfig({
      type: 'text',
      placeholder: '关键字过滤（棋手/赛事/难度等）',
      clearable: true,
    });
    this.bookmarkPanel.setVisible(false);
    this.latestPanel.setVisible(false);
    this.latestCard.setVisible(false);
    this.resultCard.setVisible(false);
    this.overlay.hide();
    // 注入 fetcher-spin keyframes（确保最新标签页的 spinner 动画生效）
    if (!document.getElementById('fetcher-spin-keyframes')) {
      const style = document.createElement('style');
      style.id = 'fetcher-spin-keyframes';
      style.textContent = '@keyframes fetcher-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
  }
  bindActions(): void {
    this.bookmarkCard.onAction((action, data) => {
      if (action === 'openBookmarkMenu' && data?.['id']) {
        this.toggleBookmarkMenu(data['id'] as string);
      } else if (action === 'viewBookmark' && data?.['id']) {
        this.cb.onViewBookmark(data['id'] as string);
      } else if (action === 'viewLatest' && data?.['url']) {
        this.cb.onSelectLatestView(data['url'] as string);
      } else if (action === 'selectLatest' && data?.['url']) {
        this.cb.onSelectLatest(data['url'] as string);
      } else if (action === 'viewUrl' && data?.['url']) {
        this.cb.onViewUrl(data['url'] as string);
      }
    });
    this.resultCard.onAction((action) => {
      if (action === "live") {
        this.cb.onLive();
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

  /** 分类 → 来源 映射 */
  private static readonly CATEGORY_SOURCES: Record<string, Array<{ value: string; label: string }>> = {
    archive: [
      { value: 'foxwq', label: '野狐围棋' },
      { value: 'katago', label: 'KataGo' },
    ],
    puzzle: [
      { value: 'weiqi101', label: '101围棋' },
      { value: 'ogs-puzzle', label: 'OGS死活题' },
      { value: 'goproblems', label: 'GoProblems' },
    ],
    live: [
      { value: 'ogs-live', label: 'OGS在线' },
      { value: 'yike-live', label: '弈客直播' },
    ],
  };

  /** 根据分类更新来源下拉框选项 */
  private _suppressSourceChange = false;
  private updateSourceOptions(category: string): void {
    const sources = FetcherRenderer.CATEGORY_SOURCES[category] || [];
    this._suppressSourceChange = true;
    this.sourceSelect.setConfig({
      options: sources,
      value: sources[0]?.value || '',
    });
    this._suppressSourceChange = false;
  }

  /** 设置最新标签页的分类 */
  setLatestCategory(category: string): void {
    this.categorySelect.setValue(category);
    this.updateSourceOptions(category);
  }

  /** 设置最新标签页的来源 */
  setLatestSource(source: string): void {
    // 自动检测分类
    for (const [cat, sources] of Object.entries(FetcherRenderer.CATEGORY_SOURCES)) {
      if (sources.some(s => s.value === source)) {
        this.categorySelect.setValue(cat);
        this.updateSourceOptions(cat);
        break;
      }
    }
    this.sourceSelect.setValue(source);
  }

  /** 设置最新标签页的浏览位置（已展示条数） */
  getLatestDisplayed(): number { return this._displayedLatest; }
  /** 设置已展示条数（用于页面返回恢复；夹紧到合法范围） */
  setLatestDisplayed(n: number): void {
    this._displayedLatest = Math.max(FetcherRenderer.LATEST_PAGE_INIT, Math.min(n, this._latestItems.length || n));
  }

  /** 设置最新标签页的关键字 */
  setLatestKeyword(keyword: string): void { this.keywordInput.setValue(keyword); }

  /** 切换到最新标签页 */
  switchToLatestTab(): void {
    this.tabs.setActiveId('latest');
    this.queryPanel.setVisible(false);
    this.latestPanel.setVisible(true);
    this.bookmarkPanel.setVisible(false);
    this.resultCard.setVisible(false);
    // 滚动到选中条目
    if (this._selectedLatestUrl) {
      setTimeout(() => {
        const el = this.latestCard.getContainer?.() as HTMLElement | undefined;
        if (!el) return;
        const sel = '[data-url="' + (this._selectedLatestUrl || '').replace(/"/g, '\\"') + '"]';
        const target = el.querySelector(sel) as HTMLElement | null;
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  }
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
   * 设置当前选中的最新棋谱URL（用于高亮）
   */
  setSelectedLatestUrl(url: string | null): void {
    this._selectedLatestUrl = url;
  }

  /**
   * 用缓存数据重新渲染列表（高亮选中项）
   */
  rerenderLatest(): void {
    if (this._latestItems.length > 0) {
      this.renderLatestGames(this._latestItems);
    }
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
        const keyword = this.keywordInput.getValue().trim();
        this.cb.onFetchLatest(source, keyword || undefined);
      }
    });
    // 分类切换时更新来源列表并自动刷新
    this.categorySelect.onChange((category) => {
      this.updateSourceOptions(category);
      const source = this.sourceSelect.getValue() || '';
      if (!source) return;
      const keyword = this.keywordInput.getValue().trim();
      this.cb.onFetchLatest(source, keyword || undefined);
    });
    // 来源下拉框变化时自动刷新
    this.sourceSelect.onChange(() => {
      if (this._suppressSourceChange) return;
      const source = this.sourceSelect.getValue() || 'foxwq';
      const keyword = this.keywordInput.getValue().trim();
      this.cb.onFetchLatest(source, keyword || undefined);
    });
    // 关键字输入框回车触发搜索
    this.keywordInput.onEnter((value) => {
      const source = this.sourceSelect.getValue() || 'foxwq';
      const keyword = value.trim();
      this.cb.onFetchLatest(source, keyword || undefined);
    });
    // 卡片点击
    this.latestCard.onAction((action, data) => {
      if (action === 'openMenu' && data?.['url']) {
        this.toggleLatestMenu(data['url'] as string);
      } else if (action === 'selectLatest' && data?.['url']) {
        this.cb.onSelectLatest(data['url'] as string);
      } else if (action === 'viewLatest' && data?.['url']) {
        this.cb.onSelectLatestView(data['url'] as string);
      } else if (action === 'viewUrl' && data?.['url']) {
        this.cb.onViewUrl(data['url'] as string);
      }
    });
  }

  /**
   * 右上角三点扩展菜单：打开/关闭指定条目的操作菜单
   */
  toggleLatestMenu(url: string): void {
    const container = this.latestCard.getContainer?.() as HTMLElement | undefined;
    if (!container) return;
    const escapedUrl = (url || '').replace(/["]/g, '\\$&');
    const cardEl = container.querySelector('[data-url="' + escapedUrl + '"]') as HTMLElement | null;
    if (!cardEl) return;
    const existing = cardEl.querySelector('div[data-menu]') as HTMLElement | null;
    // 关闭其它已打开的菜单
    container.querySelectorAll('div[data-menu]').forEach((m) => m.remove());
    if (existing) return; // 已打开则关闭
    const tpl = cardEl.querySelector('[data-menu-template]') as HTMLElement | null;
    if (!tpl) return;
    const cloned = tpl.cloneNode(true) as HTMLElement;
    cloned.removeAttribute('data-menu-template');
    cloned.setAttribute('data-menu', '');
    cloned.style.display = '';
    (cardEl.querySelector('.latest-dots') as HTMLElement | null)?.insertAdjacentElement('afterend', cloned);
  }

  /**
   * 收藏列表右上角三点扩展菜单：打开/关闭指定收藏条目的操作菜单
   */
  toggleBookmarkMenu(id: string): void {
    const container = this.bookmarkCard.getContainer?.() as HTMLElement | undefined;
    if (!container) return;
    const escapedId = (id || '').replace(/["]/g, '\\$&');
    const cardEl = container.querySelector('[data-action="viewBookmark"][data-id="' + escapedId + '"]') as HTMLElement | null;
    if (!cardEl) return;
    const existing = cardEl.querySelector('div[data-menu]') as HTMLElement | null;
    container.querySelectorAll('div[data-menu]').forEach((m) => m.remove());
    if (existing) return; // 已打开则关闭
    const tpl = cardEl.querySelector('[data-menu-template]') as HTMLElement | null;
    if (!tpl) return;
    const cloned = tpl.cloneNode(true) as HTMLElement;
    cloned.removeAttribute('data-menu-template');
    cloned.setAttribute('data-menu', '');
    cloned.style.display = '';
    (cardEl.querySelector('.bookmark-dots') as HTMLElement | null)?.insertAdjacentElement('afterend', cloned);
  }

  /**
   * 渲染最新棋谱列表
   */
  renderLatestGames(items: LatestGameItem[]): void {
    if (items.length === 0) {
      this.latestCard.setContent('');
      this.latestCard.setVisible(false);
      return;
    }
    this.latestCard.setVisible(true);
    const isNewData = items !== this._latestItems;
    this._latestItems = items;
    if (isNewData) {
      // 新查询/新批次：默认只展示前 LATEST_PAGE_INIT 盘，滑到底再追加
      this._displayedLatest = Math.min(FetcherRenderer.LATEST_PAGE_INIT, items.length);
    } else {
      // 同一批数据（如点击高亮重绘）：保持当前浏览进度
      this._displayedLatest = Math.min(this._displayedLatest, items.length);
    }
    const html = this._latestItems.slice(0, this._displayedLatest).map(item => {
      const sourceLabels: Record<string, string> = { foxwq: '🏆 野狐', weiqi101: '📝 101围棋', 'ogs-live': '🎬 OGS', 'yike-live': '📹 弈客', goproblems: '🧩 GoProblems', 'ogs-puzzle': '🧩 OGS死活题', katago: '🤖 KataGo' };
      const sourceLabel = sourceLabels[item.source] || item.source;
      const subtitle = item.subtitle
        ? `<div style="font-size:0.85em;color:#666;margin-top:4px;">${item.subtitle}</div>`
        : '';
      const isSelected = this._selectedLatestUrl === item.url;
      const bg = isSelected ? '#eef2ff' : '';
      const border = isSelected ? 'border-left:3px solid #667eea;padding-left:8px;' : '';
      const isLiveSource = item.source === 'ogs-live' || item.source === 'yike-live';
      // "查看链接"优先使用外部链接（如 KataGo 归档压缩包下载地址）
      const linkUrl = item.externalUrl || item.url;
      // 仅当是可打开的 http(s) 链接时才显示"查看链接"（katago:// 等伪协议不显示）
      const linkMenuItem = /^https?:\/\//i.test(linkUrl)
        ? `<div data-action="viewUrl" data-url="${linkUrl}" style="padding:6px 10px;cursor:pointer;font-size:0.85em;color:#2d3748;white-space:nowrap;">🔗 查看链接</div>`
        : '';
      const hoverScript = isSelected ? '' : 'onmouseover="this.style.background=\'#f8f9fa\'" onmouseout="this.style.background=\'\'"';
      // 右上角三点扩展菜单（统一所有条目的操作入口）
      const liveMenu = isLiveSource
        ? `<div data-action="viewLatest" data-url="${item.url}" style="padding:6px 10px;cursor:pointer;font-size:0.85em;color:#2d3748;white-space:nowrap;">👁\ufe0f 查看棋谱</div>
           <div data-action="selectLatest" data-url="${item.url}" style="padding:6px 10px;cursor:pointer;font-size:0.85em;color:#c53030;font-weight:600;white-space:nowrap;">🔴 直播棋谱</div>`
        : '';
      const menu = `
        <div class="latest-dots" data-action="openMenu" data-url="${item.url}"
             style="position:absolute;top:8px;right:8px;width:24px;height:24px;line-height:22px;text-align:center;border-radius:50%;color:#999;font-size:16px;cursor:pointer;user-select:none;"
             onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background=''">⋮</div>
        <div data-menu-template style="display:none;position:absolute;top:34px;right:8px;min-width:96px;background:white;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.15);z-index:50;overflow:hidden;">
          ${liveMenu}
          ${linkMenuItem}
        </div>`;
      return `<div data-action="selectLatest" data-url="${item.url}" style="position:relative;padding:10px 30px 10px 0;border-top:1px solid #eee;cursor:pointer;background:${bg};${border}" ${hoverScript}>
        ${menu}
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
    // 挂载"加载更多"哨兵，滑到底自动追加
    this.attachLoadMoreSentinel();
  }

  /**
   * 在列表底部挂载 IntersectionObserver 哨兵：滑到底自动加载更多（+10 盘）
   * 若运行环境无 IntersectionObserver（如 jsdom 测试），则直接全量展示并跳过懒加载。
   */
  private attachLoadMoreSentinel(): void {
    // 已无更多可展示：移除哨兵与 observer
    if (this._displayedLatest >= this._latestItems.length) {
      this.disposeLatestObserver();
      return;
    }
    const el = this.latestCard.getContainer?.() as HTMLElement | undefined;
    if (!el) return;
    // 运行环境不支持 IntersectionObserver（部分测试/jsdom）时不启用懒加载
    if (typeof IntersectionObserver === 'undefined') {
      // 不支持懒加载则一次性全量展示（已渲染为前10盘，这里补渲染全量）
      this._displayedLatest = this._latestItems.length;
      this.renderLatestGames(this._latestItems);
      return;
    }
    // 复用/创建底部哨兵节点
    let sentinel = this._loadMoreSentinel;
    if (!sentinel || !el.contains(sentinel)) {
      sentinel = document.createElement('div');
      sentinel.setAttribute('data-latest-sentinel', '');
      sentinel.style.cssText = 'height:1px;';
      el.appendChild(sentinel);
      this._loadMoreSentinel = sentinel;
    }
    // 重建 observer（先断开旧的）
    this._io?.disconnect();
    this._io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          this.loadMoreLatest();
          break;
        }
      }
    }, { root: null, rootMargin: '200px', threshold: 0 });
    this._io.observe(sentinel);
  }

  /**
   * 滑到底加载更多：先显示底部"加载中"spinner，短暂延迟后再追加 LATEST_PAGE_STEP 盘。
   * 纯本地切片，但保留异步刷新的体感；加载期间加锁，避免 IntersectionObserver
   * 在未填满视口时连发导致列表瞬间全部展开。
   */
  private loadMoreLatest(): void {
    if (this._loadingMore) return;
    if (this._displayedLatest >= this._latestItems.length) {
      // 已全部展示，自动停止
      this.disposeLatestObserver();
      return;
    }
    this._loadingMore = true;
    // 暂停观察，避免加载期间反复触发
    this._io?.disconnect();
    this.showLatestLoadingMore(true);
    this._loadMoreTimer = setTimeout(() => {
      this._loadMoreTimer = null;
      this._displayedLatest = Math.min(
        this._displayedLatest + FetcherRenderer.LATEST_PAGE_STEP,
        this._latestItems.length,
      );
      this._loadingMore = false;
      // 重渲染会重建哨兵/observer；到底时由 attachLoadMoreSentinel 自动清理
      this.renderLatestGames(this._latestItems);
    }, FetcherRenderer.LATEST_LOAD_DELAY);
  }

  /** 底部"加载更多"spinner 的显示/隐藏 */
  showLatestLoadingMore(show: boolean): void {
    const el = this.latestCard.getContainer?.() as HTMLElement | undefined;
    if (!el) return;
    const existing = el.querySelector('[data-latest-loading]') as HTMLElement | null;
    if (show) {
      if (existing) return;
      const spinner = document.createElement('div');
      spinner.setAttribute('data-latest-loading', '');
      spinner.style.cssText = 'text-align:center;padding:16px;';
      spinner.innerHTML = '<div style="width:24px;height:24px;border:3px solid #e0e0e0;border-top-color:#667eea;border-radius:50%;margin:0 auto 6px;animation:fetcher-spin 1s linear infinite;"></div><p style="color:#888;font-size:0.85em;margin:0;">加载中...</p>';
      el.appendChild(spinner);
    } else if (existing) {
      existing.remove();
    }
  }

  /** 清理 IntersectionObserver、哨兵与待执行的加载定时器 */
  private disposeLatestObserver(): void {
    this._io?.disconnect();
    this._io = null;
    if (this._loadMoreTimer !== null) {
      clearTimeout(this._loadMoreTimer);
      this._loadMoreTimer = null;
    }
    this._loadingMore = false;
    if (this._loadMoreSentinel) {
      this._loadMoreSentinel.remove();
      this._loadMoreSentinel = null;
    }
  }

  /**
   * 显示最新列表加载状态
   */
  showLatestLoading(show: boolean): void {
    if (show) {
      this.disposeLatestObserver();
      this.latestCard.setVisible(true);
      this.latestCard.setTitle('⏳ 加载中...');
      this.latestCard.setContent('<div style="text-align:center;padding:30px;"><div style="width:30px;height:30px;border:3px solid #e0e0e0;border-top-color:#667eea;border-radius:50%;margin:0 auto 8px;animation:fetcher-spin 1s linear infinite;"></div><p style="color:#888;font-size:0.9em;">正在获取棋谱列表...</p></div><style>@keyframes fetcher-spin{to{transform:rotate(360deg)}}</style>');
      this.latestCard.render();
    } else {
      this.latestCard.setTitle('📰 最新棋谱');
    }
  }

  /**
   * 在最新列表条目上显示/隐藏加载状态
   */
  showLatestItemLoading(url: string, show: boolean = true): void {
    const el = this.latestCard.getContainer?.() as HTMLElement | undefined;
    if (!el) return;
    const sel = '[data-url="' + url.replace(/"/g, '\\"') + '"]';
    const item = el.querySelector(sel) as HTMLElement | null;
    if (!item) return;
    if (show) {
      item.style.opacity = '0.6';
      item.style.pointerEvents = 'none';
      // 在条目右侧添加 spinner
      const existing = item.querySelector('.item-spinner');
      if (existing) return;
      const spinner = document.createElement('span');
      spinner.className = 'item-spinner';
      spinner.style.cssText = 'float:right;width:16px;height:16px;border:2px solid #ddd;border-top-color:#667eea;border-radius:50%;animation:fetcher-spin 0.8s linear infinite;margin-top:2px;';
      const titleDiv = item.querySelector('div:nth-child(2)') as HTMLElement | null;
      if (titleDiv) titleDiv.appendChild(spinner);
    } else {
      item.style.opacity = '';
      item.style.pointerEvents = '';
      const spinner = item.querySelector('.item-spinner');
      if (spinner) spinner.remove();
    }
  }

  destroy(): void {
    this.tabs.destroy();
    this.queryPanel.destroy();
    this.categorySelect.destroy();
    this.latestPanel.destroy();
    this.bookmarkPanel.destroy();
    this.resultCard.destroy();
    this.toast.destroy();
    this.overlay.destroy();
    this.qrDialog.destroy();
    this.disposeLatestObserver();
    this.hasResult = false;
    this._currentResult = undefined;
  }
}