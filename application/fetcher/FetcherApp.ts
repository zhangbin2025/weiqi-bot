/**
 * 棋谱下载应用编排器
 * @module application/fetcher/FetcherApp
 */
import type { IGameService, GameServiceResult } from '../../services/game';
import type { IFavoriteService, IFavoriteItem } from '../../services/favorite';
import type { IExportService, ExportResult } from '../../services/export';
import type { IShareService } from '../../services/share';
import type { FetcherResult, FetcherBookmark, ShareResult, FetcherFetchOptions } from './types';
import { parseSGF, coordToPos } from '../../domain/sgf';
/**
 * 棋谱下载应用编排器
 * @description 组合 GameService、FavoriteService、ShareService 完成棋谱下载、收藏管理与分享
 */
export class FetcherApp {
  private readonly CATEGORY = 'fetcher';
  constructor(
    private readonly gameService: IGameService,
    private readonly exportService: IExportService,
    private readonly favoriteService?: IFavoriteService,
    private readonly shareService?: IShareService,
  ) {}
  async fetch(url: string, options?: FetcherFetchOptions): Promise<FetcherResult> {
    const gameResult = await this.gameService.fetch(url);
    const result = this.transformResult(gameResult);
    if (result.success && this.favoriteService && !options?.live) {
      const urlHash = this.hashUrl(url);  // 使用 URL 哈希作为 key
      result.bookmarkId = await this.favoriteService.addFavorite(
        this.CATEGORY, urlHash,
        this.extractBookmarkData(result),
        `${result.metadata.black} vs ${result.metadata.white}`
      );
    }
    return result;
  }
  async getBookmarks(): Promise<FetcherBookmark[]> {
    if (!this.favoriteService) return [];
    const items = await this.favoriteService.getFavorites({ category: this.CATEGORY });
    return items.map(this.toBookmark);
  }
  async clearBookmarks(): Promise<void> {
    await this.favoriteService?.clear(this.CATEGORY);
  }
  async removeBookmark(id: string): Promise<void> {
    await this.favoriteService?.removeFavorite(id);
  }
  async isBookmarked(url: string): Promise<boolean> {
    const urlHash = this.hashUrl(url);  // 使用 URL 哈希查询
    return this.favoriteService?.isFavorited(this.CATEGORY, urlHash) ?? false;
  }
  async getArchiveContent(archiveId: string): Promise<string | null> {
    return this.gameService.getByArchiveId(archiveId);
  }
  async downloadSGF(archiveId: string, gameName: string): Promise<ExportResult> {
    const sgf = await this.gameService.getByArchiveId(archiveId);
    if (!sgf) return { success: false, error: '棋谱内容未找到' };
    return this.exportService.exportSGF(sgf, gameName);
  }
  async generateShareUrl(archiveId: string): Promise<ShareResult> {
    if (!this.shareService) return { success: false, error: '分享服务未配置' };
    const sgf = await this.gameService.getByArchiveId(archiveId);
    if (!sgf) return { success: false, error: '棋谱内容未找到' };
    const parseResult = parseSGF(sgf);
    if (parseResult.moves.length === 0) return { success: false, error: '棋谱解析失败或无手数' };
    const moves = parseResult.moves.map(m => {
      const pos = coordToPos(m.coord);
      return { color: m.color, x: pos!.x, y: pos!.y };
    });
    const shareUrl = this.shareService.generateShareUrl(moves, parseResult.gameInfo.boardSize, parseResult.gameInfo.handicap);
    if (!shareUrl) return { success: false, error: '分享链接生成失败' };
    return { success: true, shareUrl };
  }
  private transformResult(r: GameServiceResult): FetcherResult {
    const result: FetcherResult = {
      success: r.success, archiveId: r.archiveId, source: r.source, url: r.url,
      metadata: {
        black: r.metadata?.blackName ?? '',
        white: r.metadata?.whiteName ?? '',
        date: r.metadata?.date ?? '',
        movesCount: r.metadata?.movesCount ?? 0,
      },
      fromCache: r.fromCache,
    };
    if (r.archiveId !== undefined) result.archiveId = r.archiveId;
    if (r.error !== undefined) result.error = r.error;
    if (r.metadata?.result !== undefined) result.metadata.result = r.metadata.result;
    return result;
  }
  private extractBookmarkData(result: FetcherResult): Record<string, unknown> {
    return {
      archiveId: result.archiveId,
      url: result.url,  // 存储原始 URL
      source: result.source,
      black: result.metadata.black,
      white: result.metadata.white,
      result: result.metadata.result,
      date: result.metadata.date,
      movesCount: result.metadata.movesCount,
    };
  }
  private toBookmark(item: IFavoriteItem): FetcherBookmark {
    const bookmark: FetcherBookmark = {
      id: item.id,
      url: (item.data?.['url'] as string) ?? '',  // URL 从 data 中读取
      archiveId: (item.data?.['archiveId'] as string) ?? '',
      source: (item.data?.['source'] as string) ?? 'unknown',
      black: (item.data?.['black'] as string) ?? '',
      white: (item.data?.['white'] as string) ?? '',
      date: (item.data?.['date'] as string) ?? '',
      movesCount: (item.data?.['movesCount'] as number) ?? 0,
      updatedAt: item.createdAt,
    };
    const result = item.data?.['result'];
    if (result !== undefined) bookmark.result = result as string;
    return bookmark;
  }
  
  /**
   * 计算 URL 的哈希值（DJB2 算法）
   */
  private hashUrl(url: string): string {
    let hash = 5381;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) + hash) + url.charCodeAt(i);
    }
    return Math.abs(hash).toString(36);
  }
}