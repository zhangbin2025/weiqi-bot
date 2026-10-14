/**
 * 棋谱下载页面控制器
 * @module presentation/pages/fetcher/FetcherPage
 */
import type { IPage, IToast, PageParams, IAdapterFactory } from '../../../../core/interfaces';
import type { FetcherApp, FetcherResult, FetcherBookmark } from '../../../../../application/fetcher';
import type { ISessionService } from '../../../../../services/session/ISessionService';
import { FetcherRenderer, type FetcherRendererCallbacks, type FetcherRendererEvents } from './FetcherRenderer';
import { FetcherFormatter } from './FetcherFormatter';
import { detectClipboardUrl } from './utils/clipboardDetector';
import { TaskHelper } from '../../../../../clients/web/shared/task-helper';
import { buildArchiveUrl } from '../../../../../domain/sgf/SGFUtils';
import { SessionStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/SessionStorageAdapter';
import { LocalStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import { normalizePuzzleFilterState } from '../../../../../services/game/providers/library/puzzleFilter';
import {
  classifyGame,
  normalizeExternalUrl,
  type ClassifyInput,
  type GameAction,
  type GameClassification,
} from './utils/gameKind';
import type { ResultActionsInput } from './FetcherFormatter';
import type { FilterSelection } from './FetcherRenderer';
export interface FetcherPageConfig {
  fetcherApp: FetcherApp;
  adapterFactory: IAdapterFactory;
  sessionService?: ISessionService;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class FetcherPage implements IPage {
  readonly title = '棋谱下载';
  private fetcherApp: FetcherApp;
  private toast: IToast;
  private renderer: FetcherRenderer;
  private formatter: FetcherFormatter;
  private _onNavigate?: (page: string, params?: Record<string, string>) => void;
  private sessionService?: ISessionService;
  private readonly sessionStore = new SessionStorageAdapter('weiqi-bot');
  private readonly localStore = new LocalStorageAdapter('weiqi-bot');
  /** 筛选题型/难度缓存（来自 localStorage，供弹框同步读取） */
  private filterState: FilterSelection | null = null;
  private initialized = false;
  private bookmarks: FetcherBookmark[] = [];
  private currentResult: FetcherResult | undefined;
  private isLiveMode = false;
  private liveUrl?: string;
  /** 当前棋谱分类（结果卡片 / 后台任务通知共用） */
  private currentKind: GameClassification | undefined;
  /** 分类判定输入（含 SGF，用于识别 AI 标注） */
  private currentKindInput: ClassifyInput | undefined;
  constructor(config: FetcherPageConfig) {
    this.fetcherApp = config.fetcherApp;
    if (config.onNavigate !== undefined) this._onNavigate = config.onNavigate;
    if (config.sessionService !== undefined) this.sessionService = config.sessionService;
    this.toast = config.adapterFactory.createToast();
    this.formatter = new FetcherFormatter();
    const callbacks: FetcherRendererCallbacks = {
      onFetch: (url) => this.fetchByUrl(url),
      onViewBookmark: (id) => this.viewBookmark(id),
      onClearBookmarks: () => this.clearBookmarks(),
      onDownload: () => this.downloadSGF(),
      onViewSGF: () => this.viewSGF(),
      onLive: () => this.liveWatch(),
      onGenerateShareUrl: () => this.generateShareUrl(),
      onFetchLatest: (source, keyword) => this.fetchLatestGames(source, keyword),
      onRestoreKeyword: (source) => this.restoreKeyword(source),
      onSelectLatest: (url) => this.selectLatestGame(url),
      onSelectLatestView: (url) => this.viewLatestGame(url),
      onPuzzleLatest: (url) => this.puzzleLatestGame(url),
      onReviewLatest: (url) => this.latestByAction(url, 'review'),
      onDecisionLatest: (url) => this.latestByAction(url, 'decision'),
      onJosekiLatest: (url) => this.latestByAction(url, 'joseki'),
      onLiveLatest: (url) => this.latestByAction(url, 'live'),
      onDownloadLatest: (url) => this.latestByAction(url, 'download'),
      onShareLatest: (url) => this.latestByAction(url, 'share'),
      onViewUrl: (url) => this.viewUrl(url),
      onPuzzleBookmark: (id) => this.puzzleBookmark(id),
      onReviewBookmark: (id) => this.reviewBookmark(id),
      onDecisionBookmark: (id) => this.decisionBookmark(id),
      onJosekiBookmark: (id) => this.josekiBookmark(id),
      onLiveBookmark: (id) => this.liveBookmark(id),
      onDownloadBookmark: (id) => this.downloadBookmark(id),
      onShareBookmark: (id) => this.shareBookmark(id),
      onViewBookmarkSGF: (id) => this.viewBookmarkSGF(id),
      onPuzzle: () => this.puzzleCurrent(),
      onReview: () => this.reviewCurrent(),
      onDecision: () => this.decisionCurrent(),
      onJoseki: () => this.josekiCurrent(),
      onLoadFilterState: () => this.loadFilterState(),
      onSaveFilterState: (state) => this.saveFilterState(state),
    };
    // 渲染器事件：浏览位置变化时持久化到 sessionStorage
    const events: FetcherRendererEvents = {
      onDisplayedChange: async (displayed: number) => {
        try { await this.sessionStore.write('fetcher_latest_displayed', displayed); } catch { /* ignore */ }
      },
      // 当前标签变化时持久化：跳到其他页面返回时（Android WebView
      // 不支持 bfcache，会整页重载）用它恢复到离开前的标签
      onTabChange: async (tabId: string) => {
        try { await this.sessionStore.write('fetcher_active_tab', tabId); } catch { /* ignore */ }
      },
    };
    this.renderer = new FetcherRenderer(callbacks, config.adapterFactory, this.formatter, events);
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.renderer.initialize();
    this.renderer.bindActions();
    this.renderer.bindLatestActions();
    await this.loadBookmarks();
    await this.checkClipboardForUrl();
    // 恢复缓存的最新棋谱列表及查询条件
    try {
      await this.sessionStore.initialize();
      // 读取持久化的筛选题型/难度（localStorage）
      // 兼容旧版持久化结构 { types, difficulty: '3D' }：统一迁移为 difficulties 数组
      try { this.filterState = normalizePuzzleFilterState(await this.localStore.read<FilterSelection>('fetcher_filter_state')); }
      catch { this.filterState = null; }
      // 兼容旧版：曾缓存过 items，现已不再写，读到时清掉避免占用配额
      const staleItems = await this.sessionStore.read<any[]>('fetcher_latest_items');
      if (staleItems && Array.isArray(staleItems)) {
        await this.sessionStore.delete('fetcher_latest_items').catch(() => { /* ignore */ });
      }
      const cachedSource = await this.sessionStore.read<string>('fetcher_latest_source');
      if (cachedSource) {
        const cachedKeyword = await this.sessionStore.read<string>(`fetcher_latest_keyword_${cachedSource}`);
        const cachedDisplayed = await this.sessionStore.read<number>('fetcher_latest_displayed');
        const cachedSelected = await this.sessionStore.read<string>('fetcher_latest_selected');
        this.renderer.setLatestSource(cachedSource);
        if (cachedKeyword) this.renderer.setLatestKeyword(cachedKeyword);
        // 恢复列表数据但不抢焦：初始化阶段先不切标签，
        // 等下面按记录的 fetcher_active_tab 决定去向（否则在“收藏”离开的人返回时会被强拆到“最新”）
        // 按缓存条件重查，拿回完整列表（内置题库走 meta 索引，约 100ms）
        // 注意：fetchLatestGames 会清除选中态（那是「新查询」的语义），
        // 而此处是「恢复上次查询」，故重查后要把选中条目写回去。
        await this.fetchLatestGames(cachedSource, cachedKeyword || undefined);
        if (cachedSelected) {
          this.renderer.setSelectedLatestUrl(cachedSelected);
          await this.sessionStore.write('fetcher_latest_selected', cachedSelected).catch(() => { /* ignore */ });
        }
        // 恢复浏览位置（重查渲染之后设置，避免被重置为初始 10 条）
        if (cachedDisplayed) {
          this.renderer.setLatestDisplayed(cachedDisplayed);
          this.renderer.rerenderLatest();
        }
        // 定位到选中条目：必须放在重查渲染 + 写回选中态之后。
        // 早于渲染时 DOM 里还没有该条目，滚动会静默落空 —— 表现为
        // 「条目有高亮、位置没定位」。Android WebView / Electron 不支持
        // bfcache，返回即整页重载走这条恢复路径，故只有桌面端与
        // Android 上出问题；纯 web 端靠 bfcache 保留了滚动位置，因此正常。
        this.renderer.scrollToSelectedLatest();
      }
    } catch { /* ignore */ }
    // 恢复离开前所在的标签（默认“抓取”）。
    // 必须放在列表恢复之后：列表数据先准备好，
    // 再切标签才能直接就绪展示。
    // 之前无条件 switchToLatestTab()，导致在“收藏”/“抓取”
    // 离开的人返回时被强拆到“最新”。
    try {
      const cachedTab = await this.sessionStore.read<string>('fetcher_active_tab');
      if (cachedTab && cachedTab !== 'query') this.renderer.restoreTab(cachedTab);
    } catch { /* ignore */ }
    // 根据恢复后的分类/来源刷新筛选图标显隐（仅做题+内置题库显示）
    this.renderer.updateFilterIconVisibility();
    this.initialized = true;
    console.info('FetcherPage initialized');
  }
  async handleParams(params: PageParams): Promise<void> {
    // 只有确实要展示抓取结果时才切回抓取标签页（initialize 可能已切到最新标签页）。
    // 之前无条件切换：Android 返回会整页重载并重跑这里，残留参数（taskId 等）
    // 会把 initialize() 刚恢复的标签抢回「抓取」。
    const needsQueryTab =
      !!(params['sessionId'] && this.sessionService) || !!params['url'];
    if (needsQueryTab) this.renderer.switchToQueryTab();
    // 优先处理 sessionId：从 SessionService 恢复 SGF
    if (params['sessionId'] && this.sessionService) {
      try {
        const session = await this.sessionService.get<{ sgf: string }>(params['sessionId'] as string);
        if (session?.data?.sgf) {
          const archiveUrl = buildArchiveUrl(session.data.sgf);
          this.renderer.setInputValue(archiveUrl);
          this.fetchByUrl(archiveUrl, params['taskId'] as string);
          // 清理 session，避免重复使用
          await this.sessionService.delete(params['sessionId'] as string);
          return;
        }
      } catch (error) {
        console.error('[FetcherPage] 恢复 SGF 会话失败:', error);
      }
      // sessionId 无效或过期
      this.renderer.showError('会话已过期', '请重新导入 SGF 文件');
      return;
    }
    // 常规 URL 参数
    if (params['url']) {
      this.renderer.setInputValue(params['url'] as string);
      this.fetchByUrl(params['url'] as string, params['taskId'] as string);
    }
    // 来源参数（从助手跳转，指定来源但无 URL → 切到最新标签页并自动查询）
    if (params['source'] && !params['url']) {
      this.renderer.switchToLatestTab();
      this.renderer.setLatestSource(params['source'] as string);
      this.fetchLatestGames(params['source'] as string);
    }
  }
  render(): void { this.renderer.render(); }
  destroy(): void {
    this.renderer.destroy();
    this.toast.destroy();
    this.bookmarks = [];
    this.currentResult = undefined as FetcherResult | undefined;
    this.initialized = false;
    console.info('FetcherPage destroyed');
  }
  private async checkClipboardForUrl(): Promise<void> {
    const url = await detectClipboardUrl();
    if (url) {
      this.renderer.setInputValue(url);
      this.renderer.showClipboardHint();
      console.info('剪贴板 URL 已自动填充', { url });
    }
  }
  private async loadBookmarks(): Promise<void> {
    try {
      this.bookmarks = await this.fetcherApp.getBookmarks();
      this.renderer.renderBookmarks(this.bookmarks);
    } catch (error) {
      console.error('加载收藏失败', error as Error);
      this.bookmarks = [];
    }
  }
  private async clearBookmarks(): Promise<void> {
    try {
      await this.fetcherApp.clearBookmarks();
      this.bookmarks = [];
      this.renderer.renderBookmarks(this.bookmarks);
    } catch (error) {
      console.error('清除收藏失败', error as Error);
    }
  }
  /**
   * 从棋谱 URL 中提取 wqmove 参数（打印二维码时追加的手数标记）
   */
  private extractWqMove(url?: string): string | undefined {
    if (!url) return undefined;
    try {
      const u = new URL(url);
      const wqmove = u.searchParams.get('wqmove');
      return wqmove || undefined;
    } catch {
      return undefined;
    }
  }


  /**
   * 过滤不适合作为 src 的 URL（如 archive: 协议，内容太长会导致 URL 超限）
   */
  private filterSrcUrl(url: string | undefined): string {
    if (!url || url.startsWith('archive:')) return '';
    return url;
  }

  /**
   * "查看链接"目标：只接受 http(s) 开头的协议
   * @description 内置库链接（lib://life-and-death/...、lib-ai-review://...、
   *              katago://...）在浏览器里打不开，必须过滤掉 —— 否则菜单里
   *              挂着一个点了没反应的「查看链接」。
   */
  private externalLink(url: string | undefined): string | undefined {
    return normalizeExternalUrl(url) || undefined;
  }

  private async viewBookmark(id: string): Promise<void> {
    const entry = this.bookmarks.find(h => h.id === id);
    if (!entry) return;
    this.renderer.switchToQueryTab();
    this.renderer.setInputValue(entry.url);
    const result: FetcherResult = {
      success: true, archiveId: entry.archiveId, source: entry.source, url: entry.url,
      metadata: { black: entry.black, white: entry.white, date: entry.date, movesCount: entry.movesCount },
      fromCache: true,
    };
    if (entry.result !== undefined) result.metadata.result = entry.result;
    this.currentResult = result;
    this.isLiveMode = !!entry.isLive;
    if (this.isLiveMode) this.liveUrl = entry.url;
    const cls = this.classifyCurrent();
    this.renderer.showResult(result, this.buildResultActions(cls, this.externalLink(this.filterSrcUrl(entry.url))));
    this.renderer.setCurrentResult(result);
    if (entry.archiveId) void this.refineClassification(entry.archiveId);
  }
  private async fetchByUrl(url: string, taskId?: string): Promise<void> {
    this.renderer.showLoading(true, '正在抓取棋谱...');
    this.currentResult = undefined as FetcherResult | undefined;
    try {
      const result = await this.fetcherApp.fetch(url);
      this.renderer.showLoading(false);
      if (result.success) {
        this.currentResult = result;
  
        // 使用底层返回的 isLive 标识（而不是通过URL判断）
        this.isLiveMode = !!result.metadata?.isLive;
        if (this.isLiveMode) {
          this.liveUrl = url;
          console.info('进入直播模式', { url, archiveId: result.archiveId });
        }
  
        const cls = this.classifyCurrent();
        this.renderer.showResult(result, this.buildResultActions(cls, this.externalLink(this.filterSrcUrl(result.url))));
        this.renderer.setCurrentResult(result);
        if (result.archiveId) void this.refineClassification(result.archiveId);
        await this.loadBookmarks();
        console.info('棋谱下载成功', { url, archiveId: result.archiveId }); 
        
        // 后台任务完成：主链接 = 该类棋谱用户最想做的事，其余收进「更多」
        if (taskId) {
          const kind = this.currentKind;
          // 「更多」统一跳 fetcher 页面（带 url，自动抓取后展示完整三点菜单）
          const moreUrl = '/fetcher/index.html?url=' + encodeURIComponent(url);
          const primary = kind?.primary ?? 'view';
          const primaryLink = this.buildNotifyLink(primary, result);
          const labelMap: Record<string, string> = {
            view: '打谱', share: '分享', live: '直播', puzzle: '做题',
            review: '复盘', decision: '实战选点', joseki: '发现定式', download: '下载',
          };
          const primaryLabel = labelMap[primary] ?? '打谱';
          const who = `${result.metadata.black || '黑方'} vs ${result.metadata.white || '白方'}`;
          const message = `已抓取棋谱: ${who}\n\n[${primaryLabel}](${primaryLink}) [更多](${moreUrl})`;
          TaskHelper.notifyComplete(taskId, '抓取完成', message, moreUrl);
        }
      } else {
        this.renderer.showError(this.getErrorTitle(result.error), result.error || '未知错误');
        console.warn('棋谱下载失败', { url, error: result.error });
        
        // 后台任务失败
        if (taskId) {
          TaskHelper.notifyFail(taskId, result.error || '抓取失败');
        }
      }
    } catch (error) {
      this.renderer.showLoading(false);
      this.renderer.showError('网络错误', error instanceof Error ? error.message : '未知错误');
      console.error('棋谱下载异常', error as Error, { url });
      
      // 后台任务失败
      if (taskId) {
        TaskHelper.notifyFail(taskId, error instanceof Error ? error.message : '未知错误');
      }
    }
  }
  /**
   * 后台任务通知链接：按动作生成目标页 URL
   * @description 与三点菜单同源：动作 → 页面入口。通知只给首要动作 + 「更多」。
   */
  private buildNotifyLink(action: GameAction, result: FetcherResult): string {
    const archiveId = result.archiveId ?? '';
    const src = encodeURIComponent(this.filterSrcUrl(result.url));
    switch (action) {
      case 'live':
        return '/review/index.html?live=true&url=' + encodeURIComponent(result.url);
      case 'puzzle':
        return '/puzzle/index.html?archiveId=' + encodeURIComponent(archiveId) +
          '&url=' + encodeURIComponent(result.url) +
          '&source=' + encodeURIComponent(result.source || '') +
          '&src=' + src;
      case 'review':
        return '/review/index.html?archiveId=' + encodeURIComponent(archiveId) + '&src=' + src;
      case 'decision':
        // 与前台跳转（decisionCurrent → onNavigate("decision")）完全同源：
        // 归档导入路径靠 archiveId + src（src 同时作为历史条目展示名，
        // 缺失时会退化成显示一长串 archiveId）；不带 auto=true，否则一旦
        // handleTaskParams 提前 return（scheduleId / view=favorite），
        // 页面会走 auto 分支的「在线默认生成」，抓的这盘棋谱就丢了。
        return '/decision/index.html?archiveId=' + encodeURIComponent(archiveId) +
          '&source=' + encodeURIComponent(result.source || '') +
          '&src=' + src;
      case 'joseki':
        return '/joseki/discover.html?archiveId=' + encodeURIComponent(archiveId) +
          '&tab=upload&auto=true';
      case 'download':
        return '/fetcher/index.html?url=' + encodeURIComponent(result.url);
      case 'view':
      default: {
        // 题目棋谱从初始局面开始
        const isQuestion = this.currentKind?.kind === 'puzzle';
        const move = this.extractWqMove(result.url);
        const q = 'archiveId=' + encodeURIComponent(archiveId) + '&src=' + src;
        return '/replay/index.html?' + q +
          (isQuestion ? '&move=0' : (move ? '&move=' + move : ''));
      }
    }
  }

  /**
   * 获取最新棋谱列表
   */
  private async fetchLatestGames(source: string, keyword?: string): Promise<void> {
    this.renderer.showLatestLoading(true);
    try {
      // 一次拉取 LATEST_FETCH_MAX 作为本地切片池子，前端默认展示前 10 盘、滑到底再 +10
      const items = await this.fetcherApp.fetchLatestGames(
        source,
        FetcherRenderer.LATEST_FETCH_MAX,
        keyword,
      );
      this.renderer.showLatestLoading(false);
      // 新查询：清除旧选中状态
      try { await this.sessionStore.delete('fetcher_latest_selected'); } catch { /* ignore */ }
      this.renderer.setSelectedLatestUrl(null);
      this.renderer.renderLatestGames(items);
      // 缓存查询条件（不缓存 items）：页面返回时据此重查，即可回到同一列表与条目。
      //
      // 为什么不缓存 items：内置题库 4 万条，JSON 约 5MB，必然超出 sessionStorage
      // ~5MB 配额（历史上正是这点导致内置题库返回恢复不了）。
      // 改为重查的代价很低——内置题库走 meta 索引约 100ms，在线来源受网络影响但
      // 本来也不该缓存大列表。收益是列表不再被截断，题库能完整展示。
      try {
        await this.sessionStore.write('fetcher_latest_source', source);
        await this.sessionStore.write(`fetcher_latest_keyword_${source}`, keyword || '');
        await this.sessionStore.write('fetcher_latest_displayed', this.renderer.getLatestDisplayed());
      } catch (e) {
        console.warn('[FetcherPage] 查询条件缓存失败，返回时将无法恢复列表', {
          source,
          error: e instanceof Error ? e.message : String(e),
        });
        await this.clearLatestCache().catch(() => { /* ignore */ });
      }
    } catch (error) {
      this.renderer.showLatestLoading(false);
      console.error('[FetcherPage] fetchLatestGames failed:', error);
    }
  }

  /** 从缓存恢复指定来源的关键字 */
  /** 读取上次保存的筛选题型/难度（localStorage 持久化，取缓存） */
  private loadFilterState(): FilterSelection | null {
    return this.filterState;
  }

  /** 保存筛选题型/难度（localStorage 持久化） */
  private saveFilterState(state: FilterSelection): void {
    this.filterState = state;
    try { void this.localStore.write('fetcher_filter_state', state); } catch { /* ignore */ }
  }

  /** 清空最新列表的会话缓存（含已废弃的 items 键，用于清理旧版本残留） */
  private async clearLatestCache(): Promise<void> {
    await this.sessionStore.delete('fetcher_latest_items');
    await this.sessionStore.delete('fetcher_latest_source');
    await this.sessionStore.delete('fetcher_latest_displayed');
    await this.sessionStore.delete('fetcher_latest_selected');
  }

  private restoreKeyword(source: string): string | null {
    try {
      const val = sessionStorage.getItem(`weiqi-bot:fetcher_latest_keyword_${source}`);
      if (!val) return null;
      return JSON.parse(val) as string;
    } catch {
      return null;
    }
  }

  /**
   * 选择最新列表中的棋谱，后台抓取后直接跳转 replay 页面
   */
  private async selectLatestGame(url: string): Promise<void> {
    this.renderer.setSelectedLatestUrl(url);
    this.renderer.rerenderLatest();
    try {
      await this.sessionStore.write('fetcher_latest_selected', url);
      await this.sessionStore.write('fetcher_latest_displayed', this.renderer.getLatestDisplayed());
    } catch { /* ignore */ }
    // 在条目上显示加载状态
    this.renderer.showLatestItemLoading(url);
    try {
      const result = await this.fetcherApp.fetch(url);
      this.renderer.showLatestItemLoading(url, false);
      if (result.success) {
        this.currentResult = result;
        this.isLiveMode = !!result.metadata?.isLive;
        if (this.isLiveMode) this.liveUrl = url;
        await this.loadBookmarks();
        // 直播模式跳 review 页面
        if (this.isLiveMode && this.liveUrl) {
          window.location.href = "../review/index.html?live=true&url=" + encodeURIComponent(this.liveUrl);
          return;
        }
        // 判断是否是题目
        const questionPatterns = [
          /101weiqi\.com\/qday\//,
          /101weiqi\.com\/q\//,
          /101weiqi\.cn\/qday\//,
          /101weiqi\.cn\/q\//,
        ];
        const isQuestion = (result.source === 'weiqi101' &&
                           questionPatterns.some(p => p.test(result.url || ''))) ||
                           result.source === 'goproblems' ||
                             result.source === 'ogs-puzzle';
        const srcUrl = this.filterSrcUrl(result.url);
        if (!result.archiveId) return;
        if (isQuestion) {
          this._onNavigate?.('replay', { archiveId: result.archiveId, move: '0', src: srcUrl });
        } else {
          const wqmove = this.extractWqMove(result.url);
          const navParams: Record<string, string> = { archiveId: result.archiveId, src: srcUrl };
          if (wqmove) navParams['move'] = wqmove;
          this._onNavigate?.('replay', navParams);
        }
      } else {
        this.toast.show(result.error || '抓取失败');
      }
    } catch (error) {
      this.renderer.showLatestItemLoading(url, false);
      this.toast.show(error instanceof Error ? error.message : '网络错误');
    }
  }

  private async downloadSGF(): Promise<void> {
    if (!this.currentResult?.archiveId) return;
    try {
      const gameName = this.formatter.generateGameName(this.currentResult);
      await this.fetcherApp.downloadSGF(this.currentResult.archiveId, gameName);
    } catch (error) {
      console.error('下载SGF失败', error as Error);
    }
  }
  private async viewSGF(): Promise<void> {
    if (!this.currentResult?.archiveId) return;
    
    // 判断是否是题目（101围棋网 qday 或 q 页面，或 goproblems 死活题）
    const questionPatterns = [
      /101weiqi\.com\/qday\//,
      /101weiqi\.com\/q\//,
      /101weiqi\.cn\/qday\//,
      /101weiqi\.cn\/q\//,
    ];
    const isQuestion = (this.currentResult?.source === 'weiqi101' &&
                       questionPatterns.some(p => p.test(this.currentResult?.url || ''))) ||
                       this.currentResult?.source === 'goproblems' ||
                       this.currentResult?.source === 'ogs-puzzle';
    
    // 正常模式：原有逻辑
    if (!this._onNavigate) return;
    
    // 题目棋谱：从初始局面开始（move=0）
    const srcUrl = this.filterSrcUrl(this.currentResult?.url);
    if (isQuestion) {
      this._onNavigate('replay', { archiveId: this.currentResult.archiveId, move: '0', src: srcUrl });
    } else {
      // 对局棋谱：如果有 wqmove 参数则跳到指定手数，否则默认显示最后一手
      const wqmove = this.extractWqMove(this.currentResult?.url);
      const navParams: Record<string, string> = { archiveId: this.currentResult.archiveId, src: srcUrl };
      if (wqmove) navParams['move'] = wqmove;
      this._onNavigate('replay', navParams);
    }
  }
  /** 直播观看：跳转 review 页面，带 live 参数 */
  private liveWatch(): void {
    if (this.liveUrl) {
      const reviewUrl = "../review/index.html?live=true&url=" + encodeURIComponent(this.liveUrl);
      window.location.href = reviewUrl;
    }
  }
  /** 查看最新列表中的棋谱（打谱模式，不走直播） */
  private async viewLatestGame(url: string): Promise<void> {
    this.renderer.setSelectedLatestUrl(url);
    this.renderer.rerenderLatest();
    try {
      await this.sessionStore.write('fetcher_latest_selected', url);
      await this.sessionStore.write('fetcher_latest_displayed', this.renderer.getLatestDisplayed());
    } catch { /* ignore */ }
    this.renderer.showLatestItemLoading(url);
    try {
      const result = await this.fetcherApp.fetch(url);
      this.renderer.showLatestItemLoading(url, false);
      if (result.success) {
        this.currentResult = result;
        this.isLiveMode = !!result.metadata?.isLive;
        if (this.isLiveMode) this.liveUrl = url;
        await this.loadBookmarks();
        // 判断是否是题目
        const questionPatterns = [
          /101weiqi\.com\/qday\//,
          /101weiqi\.com\/q\//,
          /101weiqi\.cn\/qday\//,
          /101weiqi\.cn\/q\//,
        ];
        const isQuestion = (result.source === 'weiqi101' &&
                           questionPatterns.some(p => p.test(result.url || ''))) ||
                           result.source === 'goproblems' ||
                           result.source === 'ogs-puzzle';
        const srcUrl = this.filterSrcUrl(result.url);
        if (!result.archiveId) return;
        if (isQuestion) {
          this._onNavigate?.('replay', { archiveId: result.archiveId, move: '0', src: srcUrl });
        } else {
          const wqmove = this.extractWqMove(result.url);
          const navParams: Record<string, string> = { archiveId: result.archiveId, src: srcUrl };
          if (wqmove) navParams['move'] = wqmove;
          this._onNavigate?.('replay', navParams);
        }
      } else {
        this.toast.show(result.error || '抓取失败');
      }
    } catch (error) {
      this.renderer.showLatestItemLoading(url, false);
      console.error('[FetcherPage] viewLatestGame failed:', error);
    }
  }
  /**
   * 最新列表项按动作处理：先抓取（拿到 archiveId），再执行对应动作
   * @description 与结果卡片共用一套动作语义，区别只是入口没有现成的 archiveId。
   */
  private async latestByAction(url: string, action: GameAction): Promise<void> {
    this.renderer.setSelectedLatestUrl(url);
    this.renderer.rerenderLatest();
    try {
      await this.sessionStore.write('fetcher_latest_selected', url);
      await this.sessionStore.write('fetcher_latest_displayed', this.renderer.getLatestDisplayed());
    } catch { /* ignore */ }
    this.renderer.showLatestItemLoading(url);
    try {
      const result = await this.fetcherApp.fetch(url);
      this.renderer.showLatestItemLoading(url, false);
      if (!result.success) {
        this.toast.show(result.error || '抓取失败');
        return;
      }
      this.currentResult = result;
      this.isLiveMode = !!result.metadata?.isLive;
      if (this.isLiveMode) this.liveUrl = url;
      await this.loadBookmarks();
      if (!result.archiveId) return;

      switch (action) {
        case 'review':
          this.reviewCurrent();
          break;
        case 'decision':
          this.decisionCurrent();
          break;
        case 'joseki':
          this.josekiCurrent();
          break;
        case 'live':
          if (this.liveUrl) {
            window.location.href = '../review/index.html?live=true&url=' + encodeURIComponent(this.liveUrl);
          }
          break;
        case 'download': {
          const name = this.formatter.generateGameName(result);
          await this.fetcherApp.downloadSGF(result.archiveId, name);
          break;
        }
        case 'share': {
          const shareResult = await this.fetcherApp.generateShareUrl(result.archiveId);
          if (shareResult.success) await this.renderer.showQRCodeDialog(shareResult);
          break;
        }
        default:
          break;
      }
    } catch (error) {
      this.renderer.showLatestItemLoading(url, false);
      console.error('[FetcherPage] latestByAction failed:', error);
    }
  }

  /**
   * 做题：抓取题目后跳到做题页面（puzzle）进行交替落子答题
   */
  private async puzzleLatestGame(url: string): Promise<void> {
    this.renderer.setSelectedLatestUrl(url);
    this.renderer.rerenderLatest();
    try {
      await this.sessionStore.write('fetcher_latest_selected', url);
      await this.sessionStore.write('fetcher_latest_displayed', this.renderer.getLatestDisplayed());
    } catch { /* ignore */ }
    this.renderer.showLatestItemLoading(url);
    try {
      const result = await this.fetcherApp.fetch(url);
      this.renderer.showLatestItemLoading(url, false);
      if (result.success) {
        this.currentResult = result;
        await this.loadBookmarks();
        const srcUrl = this.filterSrcUrl(result.url);
        if (!result.archiveId) return;
        // 带上来源，做题页面才能把下拉框显示成实际来源
        // （否则会回落到默认的「内置题库」，与题目实际来源不符）
        const navParams: Record<string, string> = {
          archiveId: result.archiveId,
          url,
          src: srcUrl,
        };
        if (result.source) navParams['source'] = result.source;
        this._onNavigate?.('puzzle', navParams);
      } else {
        this.toast.show(result.error || '抓取失败');
      }
    } catch (error) {
      this.renderer.showLatestItemLoading(url, false);
      console.error('[FetcherPage] puzzleLatestGame failed:', error);
    }
  }

  /**
   * 按棋谱类别构造结果卡片操作区
   * @description 首要动作 = 该类棋谱用户最想做的事（直播→直播、死活题→做题、
   *              带 AI 标注→实战选点、其余→打谱）；其余动作收进三点菜单。
   */
  private buildResultActions(cls: GameClassification, externalUrl?: string): ResultActionsInput {
    // 首要动作已排在 actions[0]，次要动作取下一个非分享动作
    const primary: GameAction = cls.primary;
    const secondary = cls.actions.find((a) => a !== primary && a !== 'share') ?? null;
    return {
      primary,
      secondary,
      actions: cls.actions,
      externalUrl,
    };
  }

  /**
   * 对当前结果做分类（同步判定 source/isLive；SGF 缺失时降级）
   * @param sgf 可选的 SGF 内容，用于识别 AI 标注
   */
  private classifyCurrent(sgf?: string): GameClassification {
    const r = this.currentResult;
    const input: ClassifyInput = {
      source: r?.source ?? '',
      url: r?.url,
      isLive: r?.metadata?.isLive,
      isEnded: r?.metadata?.isEnded,
      externalUrl: this.externalLink(this.filterSrcUrl(r?.url)),
      sgf,
    };
    this.currentKindInput = input;
    this.currentKind = classifyGame(input);
    return this.currentKind;
  }

  /**
   * 抓取完成后异步升级分类：取 SGF 头部识别 AI 标注
   * @description 初判（按 source/isLive）已渲染菜单，此处仅在升级为 ai-review 时刷新。
   */
  private async refineClassification(archiveId: string): Promise<void> {
    if (!archiveId) return;
    try {
      const sgf = await this.fetcherApp.getArchiveContent(archiveId);
      if (!sgf) return;
      const before = this.currentKind?.kind;
      const cls = this.classifyCurrent(sgf);
      if (cls.kind === before) return; // 类别未变，不重绘
      const actions = this.buildResultActions(cls, this.externalLink(this.filterSrcUrl(this.currentResult?.url)));
      this.renderer.updateResultActions(actions);
    } catch {
      /* 分类升级失败不影响主流程 */
    }
  }

  /** 做题：当前结果跳做题页面 */
  private async puzzleCurrent(): Promise<void> {
    const r = this.currentResult;
    if (!r?.archiveId) return;
    const srcUrl = this.filterSrcUrl(r.url);
    const navParams: Record<string, string> = {
      archiveId: r.archiveId,
      url: r.url,
      src: srcUrl,
    };
    if (r.source) navParams['source'] = r.source;
    this._onNavigate?.('puzzle', navParams);
  }

  /** 复盘：当前结果跳复盘页面（本地模型分析） */
  private reviewCurrent(): void {
    const r = this.currentResult;
    if (!r?.archiveId) return;
    // 直播棋谱走直播模式（带 live 参数），其余走归档复盘
    if (this.isLiveMode && this.liveUrl) {
      window.location.href = '../review/index.html?live=true&url=' + encodeURIComponent(this.liveUrl);
      return;
    }
    this._onNavigate?.('review', { archiveId: r.archiveId, src: this.filterSrcUrl(r.url) });
  }

  /** 实战选点：当前结果跳实战选点页面 */
  private decisionCurrent(): void {
    const r = this.currentResult;
    if (!r?.archiveId) return;
    this._onNavigate?.('decision', {
      archiveId: r.archiveId,
      source: r.source || '',
      src: this.filterSrcUrl(r.url),
    });
  }

  /** 发现定式：当前结果跳定式发现页面 */
  private josekiCurrent(): void {
    const r = this.currentResult;
    if (!r?.archiveId) return;
    this._onNavigate?.('joseki', {
      archiveId: r.archiveId,
      source: r.source || '',
      src: this.filterSrcUrl(r.url),
    });
  }

  /**
   * 收藏条目的后续动作（做题/复盘/实战选点/发现定式/…）
   * @description 收藏里已有 archiveId，无需重新抓取 —— 直接跳目标页面即可。
   *              直播这类需要实时 URL 的动作才回退为「先取 URL 再跳转」。
   */
  private bookmarkEntry(id: string): FetcherBookmark | undefined {
    return this.bookmarks.find((b) => b.id === id);
  }

  /** 收藏：做题 */
  private puzzleBookmark(id: string): void {
    const e = this.bookmarkEntry(id);
    if (!e?.archiveId) return;
    const navParams: Record<string, string> = {
      archiveId: e.archiveId,
      url: e.url,
      src: this.filterSrcUrl(e.url),
    };
    if (e.source) navParams['source'] = e.source;
    this._onNavigate?.('puzzle', navParams);
  }

  /** 收藏：复盘（本地模型分析） */
  private reviewBookmark(id: string): void {
    const e = this.bookmarkEntry(id);
    if (!e?.archiveId) return;
    if (e.isLive) {
      window.location.href = '../review/index.html?live=true&url=' + encodeURIComponent(e.url);
      return;
    }
    this._onNavigate?.('review', { archiveId: e.archiveId, src: this.filterSrcUrl(e.url) });
  }

  /** 收藏：实战选点 */
  private decisionBookmark(id: string): void {
    const e = this.bookmarkEntry(id);
    if (!e?.archiveId) return;
    this._onNavigate?.('decision', {
      archiveId: e.archiveId,
      source: e.source || '',
      src: this.filterSrcUrl(e.url),
    });
  }

  /** 收藏：发现定式 */
  private josekiBookmark(id: string): void {
    const e = this.bookmarkEntry(id);
    if (!e?.archiveId) return;
    this._onNavigate?.('joseki', {
      archiveId: e.archiveId,
      source: e.source || '',
      src: this.filterSrcUrl(e.url),
    });
  }

  /** 收藏：直播观看 */
  private liveBookmark(id: string): void {
    const e = this.bookmarkEntry(id);
    if (!e) return;
    window.location.href = '../review/index.html?live=true&url=' + encodeURIComponent(e.url);
  }

  /** 收藏：下载 SGF */
  private async downloadBookmark(id: string): Promise<void> {
    const e = this.bookmarkEntry(id);
    if (!e?.archiveId) return;
    try {
      const name = `${e.black || '未知'}_vs_${e.white || '未知'}`;
      await this.fetcherApp.downloadSGF(e.archiveId, name);
    } catch (error) {
      console.error('下载SGF失败', error as Error);
    }
  }

  /** 收藏：生成分享链接 */
  private async shareBookmark(id: string): Promise<void> {
    const e = this.bookmarkEntry(id);
    if (!e?.archiveId) return;
    try {
      const shareResult = await this.fetcherApp.generateShareUrl(e.archiveId);
      if (shareResult.success) await this.renderer.showQRCodeDialog(shareResult);
      else console.warn(shareResult.error || '分享链接生成失败');
    } catch (error) {
      console.error('生成分享链接失败', error as Error);
    }
  }

  /** 收藏：打谱（跳 replay） */
  private viewBookmarkSGF(id: string): void {
    const e = this.bookmarkEntry(id);
    if (!e?.archiveId) return;
    this._onNavigate?.('replay', {
      archiveId: e.archiveId,
      src: this.filterSrcUrl(e.url),
    });
  }

  /** 直接在新标签页打开条目的原始 URL（仅 http(s)，内置库伪协议不开窗） */
  private viewUrl(url: string): void {
    const safe = this.externalLink(url);
    if (!safe) return;
    window.open(safe, '_blank', 'noopener');
  }

  private async generateShareUrl(): Promise<void> {
    if (!this.currentResult?.archiveId) return;
    try {
      const shareResult = await this.fetcherApp.generateShareUrl(this.currentResult.archiveId);
      if (shareResult.success) await this.renderer.showQRCodeDialog(shareResult);
      else console.warn(shareResult.error || '分享链接生成失败');
    } catch (error) {
      console.error('生成分享链接失败', error as Error);
    }
  }
  private getErrorTitle(error?: string): string {
    const titles: Record<string, string> = {
      INPUT_EMPTY: '输入为空', INPUT_ERROR: '输入错误', UNSUPPORTED_URL: '不支持的链接',
      TIMEOUT_ERROR: '请求超时', FETCH_ERROR: '下载失败', AUTH_ERROR: '认证失败',
      SERVER_ERROR: '服务器错误', NETWORK_ERROR: '网络错误',
    };
    if (!error) return '下载失败';
    for (const [code, title] of Object.entries(titles)) if (error.includes(code)) return title;
    return '下载失败';
  }

  /**
   * 检测是否为直播链接
   */
  private detectLiveUrl(url: string): boolean {
    const livePatterns = [
      /h5\.foxwq\.com\/yehunewshare/i,
      /h5\.foxwq\.com.*svrtype=20010/i,
      /yikeweiqi\.com.*room\/(\d+)/i,
      /home\.yikeweiqi\.com.*room\/(\d+)/i,
    ];
    return livePatterns.some(pattern => pattern.test(url));
  }

  /**
   * 检测是否在 App 环境
   */
  private isAppEnvironment(): boolean {
    return typeof navigator !== 'undefined' && 
           navigator.userAgent.includes('WeiqiApp');
  }
}
