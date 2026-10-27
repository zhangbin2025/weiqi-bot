/**
 * 棋谱下载页面渲染器
 * @module presentation/pages/fetcher/FetcherRenderer
 */
import type { ITabs, ICard, IInput, IButton, IPanel, IToast, IOverlay, ISelect, IAdapterFactory } from '../../../../core/interfaces';
import type { FetcherResult, FetcherBookmark, ShareResult, LatestGameItem } from '../../../../../application/fetcher';
import type { FetcherFormatter } from './FetcherFormatter';
import type { ResultActionsInput } from './FetcherFormatter';
import {
  classifyGame,
  actionLabel,
  isEmphasizedAction,
  normalizeExternalUrl,
  type ClassifyInput,
  type GameAction,
} from './utils/gameKind';
import { WebOverlay } from '../../components/Overlay';
import { WebQRCodeDialog } from '../../components/QRCodeDialog';
import {
  PUZZLE_FILTER_TYPES,
  PUZZLE_FILTER_DIFFICULTIES,
  normalizeDifficulties,
  buildPuzzleKeyword,
  type PuzzleFilterState,
} from '../../../../../services/game/providers/library/puzzleFilter';
/**
 * 筛选关键字生成的题型/难度选择状态（持久化用）
 * @description 直接复用题库筛选状态：题型复选 + 难度复选，与做题页同一套结构。
 */
export type FilterSelection = PuzzleFilterState;

/** 渲染器事件回调（非用户交互事件） */
export interface FetcherRendererEvents {
  /** 浏览位置变化（_displayedLatest 改变），需要持久化 */
  onDisplayedChange?: (displayed: number) => void;
  /** 当前标签变化，需要持久化（返回时恢复用） */
  onTabChange?: (tabId: string) => void;
}
/** 渲染器回调 */
export interface FetcherRendererCallbacks {
  onFetch: (url: string) => Promise<void>;
  onViewBookmark: (id: string) => Promise<void>;
  onClearBookmarks: () => Promise<void>;
  onDownload: () => Promise<void>;
  onViewSGF: () => Promise<void>;
  onLive: () => void;
  onGenerateShareUrl: () => Promise<void>;
  /** 做题：跳做题页面（死活题） */
  onPuzzle?: () => Promise<void>;
  /** 复盘：跳复盘页面（本地模型分析） */
  onReview?: () => void;
  /** 实战选点：跳实战选点页面（带 AI 标注棋谱） */
  onDecision?: () => void;
  /** 发现定式：跳定式发现页面 */
  onJoseki?: () => void;
  onSelectLatestView: (url: string) => void;
  /** 拉取最新列表（数量由渲染器统一控制为 LATEST_FETCH_MAX 池子大小） */
  onFetchLatest: (source: string, keyword?: string) => Promise<void>;
  /** 切换来源时，恢复该来源之前的关键字（从缓存读取） */
  onRestoreKeyword?: (source: string) => string | null;
  onSelectLatest: (url: string) => void;
  onViewUrl: (url: string) => void;
  /** 收藏条目：做题 */
  onPuzzleBookmark?: (id: string) => void;
  /** 收藏条目：复盘 */
  onReviewBookmark?: (id: string) => void;
  /** 收藏条目：实战选点 */
  onDecisionBookmark?: (id: string) => void;
  /** 收藏条目：发现定式 */
  onJosekiBookmark?: (id: string) => void;
  /** 收藏条目：直播 */
  onLiveBookmark?: (id: string) => void;
  /** 收藏条目：下载 SGF */
  onDownloadBookmark?: (id: string) => void;
  /** 收藏条目：分享 */
  onShareBookmark?: (id: string) => void;
  /** 收藏条目：打谱（查看） */
  onViewBookmarkSGF?: (id: string) => void;
  /** 研究题目：跳 replay 页面「研究题目模式」（非做题模式） */
  onPuzzleLatest?: (url: string) => void;
  /** 列表项：复盘（本地模型） */
  onReviewLatest?: (url: string) => void;
  /** 列表项：实战选点 */
  onDecisionLatest?: (url: string) => void;
  /** 列表项：发现定式 */
  onJosekiLatest?: (url: string) => void;
  /** 列表项：直播 */
  onLiveLatest?: (url: string) => void;
  /** 列表项：下载 SGF */
  onDownloadLatest?: (url: string) => void;
  /** 列表项：分享 */
  onShareLatest?: (url: string) => void;
  /** 打开筛选框时，恢复上次保存的题型/难度（无则返回 null） */
  onLoadFilterState?: () => FilterSelection | null;
  /** 生成筛选后，保存题型/难度（用于下次打开时恢复） */
  onSaveFilterState?: (state: FilterSelection) => void;
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
  readonly filterIconBtn: HTMLButtonElement;
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
  /** 当前结果卡片的操作区配置（三点菜单渲染/刷新用） */
  private _resultActions: ResultActionsInput | undefined;
  private _events: FetcherRendererEvents;

  constructor(
    private readonly cb: FetcherRendererCallbacks,
    private readonly factory: IAdapterFactory,
    private readonly formatter: FetcherFormatter,
    events?: FetcherRendererEvents,
  ) {
    this._events = events || {};
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
    // 筛选关键字生成图标（仅做题+内置题库显示）
    this.filterIconBtn = document.createElement('button');
    this.filterIconBtn.type = 'button';
    this.filterIconBtn.className = 'fetcher-filter-icon';
    this.filterIconBtn.title = '筛选关键字生成';
    this.filterIconBtn.setAttribute('aria-label', '筛选关键字生成');
    // 用内联 SVG 保证图标在按钮内水平/垂直居中
    this.filterIconBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
      'stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="4" y1="6" x2="20" y2="6"></line>' +
      '<line x1="4" y1="12" x2="20" y2="12"></line>' +
      '<line x1="4" y1="18" x2="20" y2="18"></line>' +
      '<circle cx="9" cy="6" r="2" fill="#fff"></circle>' +
      '<circle cx="15" cy="12" r="2" fill="#fff"></circle>' +
      '<circle cx="8" cy="18" r="2" fill="#fff"></circle>' +
      '</svg>';
    this.filterIconBtn.style.display = 'none';
    this.filterIconBtn.addEventListener('click', () => this.openFilterDialog());
    // 把图标放到关键字输入框同一行右侧
    const kwContainer = this.keywordInput.getContainer?.() as HTMLElement | undefined;
    if (kwContainer) {
      const row = document.createElement('div');
      row.className = 'fetcher-keyword-row';
      // 用 row 替换 keyword 输入框容器（若无父节点则直接包裹）
      if (kwContainer.parentElement) {
        kwContainer.parentElement.replaceChild(row, kwContainer);
      }
      row.appendChild(kwContainer);
      row.appendChild(this.filterIconBtn);
    }
    this.overlay = new WebOverlay();
    this.qrDialog = new WebQRCodeDialog({ title: '扫码打开链接', hint: '截图或长按二维码识别，扫码后打开该棋谱链接' });
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
      // 当前标签变化时通知页面持久化，供返回时恢复
      this._events.onTabChange?.(id);
      // 切到最新标签页时，滚动到选中条目（列表已在内存中，可直接定位）
      if (id === 'latest') this.scrollToSelectedLatest();
    });
    this.queryPanel.setTitle('📋 分享链接');
    this.input.setConfig({ type: 'textarea', placeholder: '支持：野狐、弈城、OGS、101围棋、弈客、元萝卜、腾讯围棋等平台...\n内置棋谱：lib://life-and-death/2026-10-12/0', clearable: true });
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
      placeholder: '筛选（支持 and/or 语法）',
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
        return;
      }
      // 菜单动作点了就该收起菜单，否则浮层一直挂着
      if (action !== 'viewBookmark') this.closeBookmarkMenu();
      if (action === 'viewUrl' && data?.['url']) {
        this.cb.onViewUrl(data['url'] as string);
        return;
      }
      // 收藏条目的动作统一按收藏 ID 走（菜单项同时带 id 与 url）
      const id = data?.['id'] as string | undefined;
      if (id) {
        switch (action) {
          case 'viewBookmark': this.cb.onViewBookmark(id); return;
          case 'view': this.cb.onViewBookmarkSGF?.(id); return;
          case 'puzzle': this.cb.onPuzzleBookmark?.(id); return;
          case 'review': this.cb.onReviewBookmark?.(id); return;
          case 'decision': this.cb.onDecisionBookmark?.(id); return;
          case 'joseki': this.cb.onJosekiBookmark?.(id); return;
          case 'live': this.cb.onLiveBookmark?.(id); return;
          case 'download': this.cb.onDownloadBookmark?.(id); return;
          case 'share': this.cb.onShareBookmark?.(id); return;
          default: break;
        }
      }
      // 兼容：只有 url 的条目（最新列表复用同一卡片时）
      if (action === 'viewLatest' && data?.['url']) {
        this.cb.onSelectLatestView(data['url'] as string);
      } else if (action === 'selectLatest' && data?.['url']) {
        this.cb.onSelectLatest(data['url'] as string);
      }
    });
    this.resultCard.onAction((action, data) => {
      if (action === "openResultMenu") {
        this.toggleResultMenu();
      } else {
        this.closeResultMenu();
      }
      if (action === "live") {
        this.cb.onLive();
      } else if (action === "download") {
        this.cb.onDownload();
      } else if (action === "view") {
        this.cb.onViewSGF();
      } else if (action === "share") {
        this.cb.onGenerateShareUrl();
      } else if (action === "puzzle") {
        this.cb.onPuzzle?.();
      } else if (action === "review") {
        this.cb.onReview?.();
      } else if (action === "decision") {
        this.cb.onDecision?.();
      } else if (action === "joseki") {
        this.cb.onJoseki?.();
      } else if (action === "viewUrl" && data?.['url']) {
        this.cb.onViewUrl(data['url'] as string);
      }
    });
  }
  switchToQueryTab(): void {
    this.tabs.setActiveId('query');
    this.queryPanel.setVisible(true);
    this.latestPanel.setVisible(false);
    this.bookmarkPanel.setVisible(false);
    this.resultCard.setVisible(this.hasResult);
    // setActiveId 是内部状态写入，不经过 onClick，需显式补发
    this._events.onTabChange?.('query');
  }
  setInputValue(value: string): void { this.input.setValue(value); }

  /** 分类 → 来源 映射 */
  private static readonly CATEGORY_SOURCES: Record<string, Array<{ value: string; label: string }>> = {
    archive: [
      { value: 'lib-ai-review', label: '内置棋谱' },
      { value: 'foxwq', label: '野狐围棋' },
      { value: 'katago', label: 'KataGo' },
    ],
    puzzle: [
      { value: 'lib-life-death', label: '内置题库' },
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

  // —— 筛选关键字生成（仅做题分类 + 内置题库来源） ——
  /** 是否允许显示筛选图标（仅做题 + 内置题库） */
  private canShowFilterIcon(): boolean {
    return this.categorySelect.getValue() === 'puzzle' && this.sourceSelect.getValue() === 'lib-life-death';
  }

  /** 更新筛选图标显隐 */
  updateFilterIconVisibility(): void {
    if (!this.filterIconBtn) return;
    this.filterIconBtn.style.display = this.canShowFilterIcon() ? '' : 'none';
  }

  /** 打开筛选关键字生成弹框 */
  private openFilterDialog(): void {
    if (!this.canShowFilterIcon()) return;
    const dialog = document.createElement('div');
    dialog.className = 'fetcher-filter-dialog';

    // 恢复上次保存的筛选状态（无则全不预选：不选 = 全部）
    const savedState = this.cb.onLoadFilterState?.() ?? null;
    const savedTypes = savedState ? savedState.types : [];
    // 难度支持复选（兼容性：旧版持久化的是单值 difficulty）
    const savedDifficulties = savedState
      ? normalizeDifficulties(savedState.difficulties ?? (savedState as { difficulty?: string }).difficulty)
      : [];
    const savedDiffSet = new Set(savedDifficulties);

    const typeCheckboxes = PUZZLE_FILTER_TYPES.map((t) => (
      '<label class="fetcher-filter-type">' +
        '<input type="checkbox" data-type="' + t.value + '"' +
          (savedTypes.includes(t.value) ? ' checked' : '') + ' />' +
        '<span>' + t.label + '</span>' +
      '</label>'
    )).join('');

    // 难度与题型一致改用复选胶囊：多选按 or 组合，不选即「全部难度」（与做题页一致）
    const difficultyChips = PUZZLE_FILTER_DIFFICULTIES.map((d) => (
      '<label class="fetcher-filter-diff' + (savedDiffSet.has(d) ? ' active' : '') + '">' +
        '<input type="checkbox" data-difficulty="' + d + '"' +
          (savedDiffSet.has(d) ? ' checked' : '') + ' />' +
        '<span>' + d + '</span>' +
      '</label>'
    )).join('');

    dialog.innerHTML = (
      '<div class="dialog-overlay show">' +
        '<div class="dialog">' +
          '<div class="dialog-title">筛选关键字生成</div>' +
          '<div class="fetcher-filter-section">' +
            '<div class="fetcher-filter-label fetcher-filter-label-row">' +
              '<span>题型（可多选，不选=全部）</span>' +
              '<button type="button" class="fetcher-filter-clear" data-act="clear-type">清空</button>' +
            '</div>' +
            '<div class="fetcher-filter-types">' + typeCheckboxes + '</div>' +
          '</div>' +
          '<div class="fetcher-filter-section">' +
            '<div class="fetcher-filter-label fetcher-filter-label-row">' +
              '<span>难度（可多选，不选=全部）</span>' +
              '<button type="button" class="fetcher-filter-clear" data-act="clear-diff">清空</button>' +
            '</div>' +
            '<div class="fetcher-filter-difficulties">' + difficultyChips + '</div>' +
          '</div>' +
          '<div class="dialog-btn-group">' +
            '<button class="dialog-btn secondary" data-act="cancel">取消</button>' +
            '<button class="dialog-btn primary" data-act="ok">生成并筛选</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(dialog);

    /** 选中态同步到胶囊样式（active 高亮） */
    const syncChip = (input: HTMLInputElement) => {
      const label = input.closest('.fetcher-filter-diff');
      if (label) label.classList.toggle('active', input.checked);
    };
    dialog.querySelectorAll<HTMLInputElement>('input[data-difficulty]').forEach((input) => {
      input.addEventListener('change', () => syncChip(input));
    });

    /** 读取当前勾选的难度（按选项表顺序输出，保证关键字稳定） */
    const readDifficulties = (): string[] => {
      const picked: string[] = [];
      dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-difficulty]')
        .forEach((cb) => { if (cb.checked && cb.dataset['difficulty']) picked.push(cb.dataset['difficulty']!); });
      return PUZZLE_FILTER_DIFFICULTIES.filter((d) => picked.includes(d));
    };

    dialog.querySelector('[data-act="clear-diff"]')?.addEventListener('click', () => {
      dialog.querySelectorAll<HTMLInputElement>('input[data-difficulty]').forEach((input) => {
        input.checked = false;
        syncChip(input);
      });
    });
    // 题型清空：不预勾选任何题型，回落到「不按题型筛选」
    dialog.querySelector('[data-act="clear-type"]')?.addEventListener('click', () => {
      dialog.querySelectorAll<HTMLInputElement>('input[data-type]').forEach((input) => {
        input.checked = false;
      });
    });

    const close = () => dialog.remove();
    const onCancel = () => close();
    const onOk = () => {
      const types: string[] = [];
      dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-type]:checked')
        .forEach((cb) => { const v = cb.dataset['type']; if (v) types.push(v); });
      const difficulties = readDifficulties();
      const keyword = buildPuzzleKeyword(types, difficulties);
      this.cb.onSaveFilterState?.({ types, difficulties });
      close();
      const source = this.sourceSelect.getValue() || 'lib-life-death';
      this.keywordInput.setValue(keyword);
      this.cb.onFetchLatest(source, keyword || undefined);
    };

    dialog.querySelector('[data-act="cancel"]')?.addEventListener('click', onCancel);
    dialog.querySelector('[data-act="ok"]')?.addEventListener('click', onOk);
    const overlayEl = dialog.querySelector('.dialog-overlay');
    overlayEl?.addEventListener('click', (e) => { if (e.target === overlayEl) onCancel(); });
  }


  /** 当前激活标签 id */
  getActiveTabId(): string { return this.tabs.getActiveId(); }

  /**
   * 恢复到指定标签（页面重载后用）
   * @description 与 switchToLatestTab/switchToQueryTab 不同：不触发 onTabChange，
   *              否则会把刚读出来的目标值原样写回去（虽然结果相同，
   *              但恢复期间任何额外切换都会污染存储）。
   */
  restoreTab(tabId: string): void {
    this.tabs.setActiveId(tabId);
    this.queryPanel.setVisible(tabId === 'query');
    this.latestPanel.setVisible(tabId === 'latest');
    this.bookmarkPanel.setVisible(tabId === 'bookmarks');
    this.resultCard.setVisible(tabId === 'query' && this.hasResult);
    if (tabId === 'latest') this.scrollToSelectedLatest();
  }

  /** 切换到最新标签页 */
  switchToLatestTab(): void {
    this.tabs.setActiveId('latest');
    this.queryPanel.setVisible(false);
    this.latestPanel.setVisible(true);
    this.bookmarkPanel.setVisible(false);
    this.resultCard.setVisible(false);
    // setActiveId 是内部状态写入，不经过 onClick，需显式补发。
    // 否则从助手带 source 跳入自动切到“最新”时不会被记录，返回时跑偏。
    this._events.onTabChange?.('latest');
    // 列表仍在内存中（同一次会话内切标签页）：直接定位到选中条目
    this.scrollToSelectedLatest();
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
  showResult(result: FetcherResult, actions: ResultActionsInput): void {
    this.hasResult = true;
    this._currentResult = result;
    this._resultActions = actions;
    this.resultCard.setTitle('📄 棋谱信息');
    this.resultCard.setContent(this.formatter.formatResultInfo(result, actions));
    this.resultCard.setVisible(true);
    this.resultCard.render();
  }
  getCurrentResult(): FetcherResult | undefined { return this._currentResult; }
  setCurrentResult(result: FetcherResult): void { this._currentResult = result; }

  /**
   * 刷新结果卡片操作区（分类升级后重渲染，如识别出 AI 标注）
   * @description 只换操作区，避免整卡重绘导致棋盘/滚动位置丢失。
   */
  updateResultActions(actions: ResultActionsInput): void {
    this._resultActions = actions;
    const container = this.resultCard.getContainer?.() as HTMLElement | undefined;
    if (!container) return;
    // 菜单已展开时先收起，避免替换 DOM 后残留浮层
    this.closeResultMenu();
    // 操作区包裹层：含按钮行与菜单模板，整体替换
    const wrapper = container.querySelector('.result-actions') as HTMLElement | null;
    if (!wrapper) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this.formatter.formatResultActions(actions);
    const next = tmp.firstElementChild as HTMLElement | null;
    if (next) wrapper.replaceWith(next);
  }

  /**
   * 结果卡片「更多 ⋯」扩展菜单：打开/关闭
   * @description 菜单就地展开在「更多」按钮下方（右侧对齐），
   *              不再使用卡片右上角三点按钮 —— 那个位置容易误触，
   *              且和第三个按钮语义重复。
   */
  toggleResultMenu(): void {
    const container = this.resultCard.getContainer?.() as HTMLElement | undefined;
    if (!container) return;
    const existing = container.querySelector('div[data-menu]') as HTMLElement | null;
    this.closeResultMenu();
    if (existing) return; // 点第二下即收起
    const wrapper = container.querySelector('.result-actions') as HTMLElement | null;
    if (!wrapper) return;
    const tpl = wrapper.querySelector('[data-menu-template]') as HTMLElement | null;
    if (!tpl) return;
    const cloned = tpl.cloneNode(true) as HTMLElement;
    cloned.removeAttribute('data-menu-template');
    cloned.setAttribute('data-menu', '');
    cloned.style.display = '';
    // 菜单挂在整行按钮之后（不是行内，否则会变成第 4 个按钮），
    // 定位 top:100% → 落在「更多」按钮正下方、右边缘对齐
    (wrapper.querySelector('.result-actions-row') as HTMLElement | null)
      ?.insertAdjacentElement('afterend', cloned);
  }

  /** 关闭结果卡片已展开的扩展菜单 */
  closeResultMenu(): void {
    const container = this.resultCard.getContainer?.() as HTMLElement | undefined;
    if (!container) return;
    container.querySelectorAll('div[data-menu]').forEach((m) => m.remove());
  }
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
   * 滚动到选中条目（无选中项时静默返回）
   *
   * 必须在列表渲染完成之后调用：早于渲染时 DOM 里还没有该条目，
   * querySelector 返回 null、滚动被静默跳过 —— 页面表现就是
   * 「条目有高亮，但没有定位到它」。
   *
   * 返回恢复路径（FetcherPage.initialize）最容易踩这点：它是
   * 「异步重查 → 渲染 → 写回选中态」，选中态是在渲染之后才设上的，
   * 任何在重查前/重查中触发的滚动都必然落空。
   *
   * 浏览器有 bfcache，返回时整页从内存恢复、滚动位置天然保留，故看不出问题；
   * Android WebView / Electron 不支持 bfcache，返回即整页重载走恢复路径，
   * 于是只在桌面端与 Android 上暴露。
   *
   * 渲染完成到布局稳定之间可能还差几帧（整页重载尤其明显），
   * 故在连续几帧内重试，直到命中目标节点。
   */
  scrollToSelectedLatest(): void {
    const url = this._selectedLatestUrl;
    if (!url) return;
    // 选中项可能落在当前展示范围之外（恢复位置缓存缺失时），先扩容再定位
    this.ensureSelectedRendered();
    const selector = '[data-url="' + url.replace(/"/g, '\\"') + '"]';
    let attempts = 0;
    const tryScroll = (): void => {
      const el = this.latestCard.getContainer?.() as HTMLElement | undefined;
      const target = el?.querySelector(selector) as HTMLElement | null;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      // 目标还没进 DOM：再等几帧。始终找不到（如选中项已不在新结果里）则放弃
      if (++attempts < 5) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }

  /**
   * 保证选中条目处于已展示范围内，必要时扩容并重渲染。
   * 仅用于恢复定位：正常浏览时展示范围由用户滚动决定，不应被动扩容。
   */
  private ensureSelectedRendered(): void {
    const url = this._selectedLatestUrl;
    if (!url || this._latestItems.length === 0) return;
    const idx = this._latestItems.findIndex((item) => item.url === url);
    if (idx < 0 || idx < this._displayedLatest) return;
    this._displayedLatest = Math.min(idx + 1, this._latestItems.length);
    this.renderLatestGames(this._latestItems);
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
      this.updateFilterIconVisibility();
      if (!source) return;
      const restored = this.cb.onRestoreKeyword?.(source);
      this.keywordInput.setValue(restored || '');
      this.cb.onFetchLatest(source, restored || undefined);
    });
    // 来源下拉框变化时：恢复该来源的关键字，然后自动刷新
    this.sourceSelect.onChange(() => {
      if (this._suppressSourceChange) return;
      const source = this.sourceSelect.getValue() || 'foxwq';
      this.updateFilterIconVisibility();
      const restored = this.cb.onRestoreKeyword?.(source);
      this.keywordInput.setValue(restored || '');
      this.cb.onFetchLatest(source, restored || undefined);
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
      } else if (action === 'puzzleLatest' && data?.['url']) {
        this.cb.onPuzzleLatest?.(data['url'] as string);
      } else if (data?.['url']) {
        // 统一动作名（与结果卡片同源分类器）：按 url 走列表项处理
        const url = data['url'] as string;
        switch (action) {
          case "puzzle": this.cb.onPuzzleLatest?.(url); break;
          case "review": this.cb.onReviewLatest?.(url); break;
          case "decision": this.cb.onDecisionLatest?.(url); break;
          case "joseki": this.cb.onJosekiLatest?.(url); break;
          case "live": this.cb.onLiveLatest?.(url); break;
          case "download": this.cb.onDownloadLatest?.(url); break;
          case "share": this.cb.onShareLatest?.(url); break;
          case "view": this.cb.onSelectLatestView(url); break;
          default: break;
        }
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
    // 关闭其它已打开的菜单（含结果卡片的「更多」菜单）
    container.querySelectorAll('div[data-menu]').forEach((m) => m.remove());
    this.closeResultMenu();
    if (existing) return; // 已打开则关闭
    const tpl = cardEl.querySelector('[data-menu-template]') as HTMLElement | null;
    if (!tpl) return;
    const cloned = tpl.cloneNode(true) as HTMLElement;
    cloned.removeAttribute('data-menu-template');
    cloned.setAttribute('data-menu', '');
    cloned.style.display = '';
    (cardEl.querySelector('.latest-dots') as HTMLElement | null)?.insertAdjacentElement('afterend', cloned);
  }

  /** 收起收藏列表已展开的菜单 */
  closeBookmarkMenu(): void {
    const container = this.bookmarkCard.getContainer?.() as HTMLElement | undefined;
    if (!container) return;
    container.querySelectorAll('div[data-menu]').forEach((m) => m.remove());
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
   * 列表项三点菜单 HTML（最新列表 / 收藏列表共用）
   * @description 与结果卡片共用同一套分类器：同样的棋谱类别 → 同样的动作集。
   * @param cls 分类输入（source / url / isLive / isEnded）
   * @param urlAttr 菜单项携带的 url 值
   * @param extraItems 追加项（如收藏的「打开收藏」）
   * @param externalUrl 外链（http(s) 才追加「查看链接」，内置库伪协议忽略）
   */
  private buildMenuHtml(
    cls: ClassifyInput,
    urlAttr: string,
    extraItems: string,
    externalUrl?: string,
  ): string {
    const { actions } = classifyGame(cls);
    const HOVER = 'onmouseover="this.style.background=\'#f8f9fa\'" onmouseout="this.style.background=\'\'"';
    const items = actions
      .map((a: GameAction) =>
        '<div data-action="' + a + '" data-url="' + urlAttr + '" style="padding:6px 10px;cursor:pointer;' +
        'font-size:0.85em;' + (isEmphasizedAction(a) ? 'color:#c53030;font-weight:600;' : 'color:#2d3748;') +
        'white-space:nowrap;" ' + HOVER + '>' + actionLabel(a) + '</div>')
      .join('');
    // 外链必须是 http(s)：lib:// / katago:// 等内置库伪协议在浏览器里打不开
    const safeExternalUrl = normalizeExternalUrl(externalUrl);
    const link = safeExternalUrl
      ? '<div data-action="viewUrl" data-url="' + safeExternalUrl + '" style="padding:6px 10px;cursor:pointer;' +
        'font-size:0.85em;color:#2d3748;white-space:nowrap;" ' + HOVER + '>' + actionLabel('viewUrl') + '</div>'
      : '';
    const body = extraItems + items + link;
    if (!body) return '';
    return (
      '<div class="latest-dots" data-action="openMenu" data-url="' + urlAttr + '" ' +
        'style="position:absolute;top:8px;right:8px;width:24px;height:24px;line-height:22px;text-align:center;' +
        'border-radius:50%;color:#999;font-size:16px;cursor:pointer;user-select:none;" ' +
        'onmouseover="this.style.background=\'#f0f0f0\'" onmouseout="this.style.background=\'\'">⋮</div>' +
      '<div data-menu-template style="display:none;position:absolute;top:34px;right:8px;min-width:96px;' +
        'background:white;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.15);' +
        'z-index:50;overflow:hidden;">' + body + '</div>'
    );
  }

  /**
   * 渲染最新棋谱列表
   */
  renderLatestGames(items: LatestGameItem[]): void {
    if (items.length === 0) {
      this.latestCard.setVisible(true);
      this.latestCard.setContent('<div style="text-align:center;padding:30px;color:#888;"><div style="font-size:2em;margin-bottom:8px;">🔍</div><p style="font-size:0.95em;margin:0;">未找到匹配的题目</p><p style="font-size:0.8em;margin:8px 0 0;color:#aaa;">试试难度级别（如 5K、2D）、题目编号或日期</p></div>');
      this.latestCard.render();
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
      const sourceLabels: Record<string, string> = { foxwq: '🏆 野狐', weiqi101: '📝 101围棋', 'ogs-live': '🎬 OGS', 'yike-live': '📹 弈客', goproblems: '🧩 GoProblems', 'ogs-puzzle': '🧩 OGS死活题', katago: '🤖 KataGo', 'lib-life-death': '📚 内置题库', 'lib-ai-review': '📚 内置棋谱' };
      const sourceLabel = sourceLabels[item.source] || item.source;
      const subtitle = item.subtitle
        ? `<div style="font-size:0.85em;color:#666;margin-top:4px;">${item.subtitle}</div>`
        : '';
      const isSelected = this._selectedLatestUrl === item.url;
      const bg = isSelected ? '#eef2ff' : '';
      const border = isSelected ? 'border-left:3px solid #667eea;padding-left:8px;' : '';
      const hoverScript = isSelected ? '' : 'onmouseover="this.style.background=\'#f8f9fa\'" onmouseout="this.style.background=\'\'"';
      // 右上角三点扩展菜单：统一走棋谱分类器（与结果卡片同一套动作集）
      // "查看链接"优先使用外部链接（如 KataGo 归档压缩包下载地址）
      // 仅当是可打开的 http(s) 链接时才显示（katago:// 等伪协议不显示）
      const linkUrl = item.externalUrl || item.url;
      const menu = this.buildMenuHtml(
        { source: item.source, url: item.url, isLive: item.isLive, isEnded: item.isEnded },
        item.url,
        '',
        /^https?:\/\//i.test(linkUrl) ? linkUrl : '',
      );
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
      // 通知外部持久化新的浏览位置
      this._events.onDisplayedChange?.(this._displayedLatest);
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
