/**
 * 棋谱下载页面控制器
 * @module presentation/pages/fetcher/FetcherPage
 */
import type { IPage, IToast, PageParams, IAdapterFactory } from '../../../../core/interfaces';
import type { FetcherApp, FetcherResult, FetcherBookmark } from '../../../../../application/fetcher';
import type { ISessionService } from '../../../../../services/session/ISessionService';
import { FetcherRenderer, type FetcherRendererCallbacks } from './FetcherRenderer';
import { FetcherFormatter } from './FetcherFormatter';
import { detectClipboardUrl } from './utils/clipboardDetector';
import { TaskHelper } from '../../../../../clients/web/shared/task-helper';
import { buildArchiveUrl } from '../../../../../domain/sgf/SGFUtils';
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
  private initialized = false;
  private bookmarks: FetcherBookmark[] = [];
  private currentResult: FetcherResult | undefined;
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
      onGenerateShareUrl: () => this.generateShareUrl(),
    };
    this.renderer = new FetcherRenderer(callbacks, config.adapterFactory, this.formatter);
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.renderer.initialize();
    this.renderer.bindActions();
    await this.loadBookmarks();
    await this.checkClipboardForUrl();
    this.initialized = true;
    console.info('FetcherPage initialized');
  }
  async handleParams(params: PageParams): Promise<void> {
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
    this.renderer.showResult(result);
    this.renderer.setCurrentResult(result);
  }
  private async fetchByUrl(url: string, taskId?: string): Promise<void> {
    this.renderer.showLoading(true, '正在抓取棋谱...');
    this.currentResult = undefined as FetcherResult | undefined;
    try {
      const result = await this.fetcherApp.fetch(url);
      this.renderer.showLoading(false);
      if (result.success) {
        this.currentResult = result;
        this.renderer.showResult(result);
        this.renderer.setCurrentResult(result);
        await this.loadBookmarks();
        console.info('棋谱下载成功', { url, archiveId: result.archiveId });

        // 检测是否为直播链接 + App 环境
        const isLive = this.detectLiveUrl(url);
        const isApp = this.isAppEnvironment();
        
        // 通知 renderer 设置直播模式
        if (isLive && isApp && result.archiveId) {
        } else {
        }
        
        // 后台任务完成
        if (taskId) {
          const detailUrl = `/assistant?taskId=${taskId}`;
          
          // 检测是否在 App 环境
          const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
          
          // 构造“AI 复盘”链接
          const reviewLink = isApp 
            ? `/assistant?text=${encodeURIComponent('复盘棋谱 ' + result.archiveId)}`  // App 环境：跳转到 assistant 并发送消息
            : `/review/index.html?archiveId=${result.archiveId}`;  // 非 App 环境：直接跳转
          
          const message = `已抓取棋谱: ${result.metadata.black || '黑方'} vs ${result.metadata.white || '白方'}\n\n[打谱](/replay/index.html?archiveId=${result.archiveId}) [复盘](${reviewLink})`;
          TaskHelper.notifyComplete(taskId, '抓取完成', message, detailUrl);
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
    if (!this.currentResult?.archiveId || !this._onNavigate) return;
    this._onNavigate('replay', { archiveId: this.currentResult.archiveId });
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