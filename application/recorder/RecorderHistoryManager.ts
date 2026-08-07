/**
 * 记谱历史管理器
 * @description 负责棋谱历史的保存、查询、删除等操作
 */
import type { IGameService } from '../../services/game';
import type { IFavoriteService, IFavoriteItem } from '../../services/favorite';
import type {
  RecorderHistoryOptions,
  RecorderHistoryEntry,
  RecorderStats,
  RecorderHistoryDetail,
} from './types';
/**
 * 记谱历史管理器
 * @description 管理 Recorder 历史记录，通过 GameService 归档 SGF，通过 FavoriteService 管理收藏
 */
export class RecorderHistoryManager {
  constructor(
    private readonly gameService: IGameService,
    private readonly favoriteService: IFavoriteService,
    private readonly category: string = 'recorder',
  ) {}
  /**
   * 保存到历史
   * @description 通过 ArchiveProvider 归档 SGF，并存储 archiveId 到 FavoriteService
   * @returns 收藏 ID
   */
  async saveToHistory(
    sgf: string,
    state: { moveHistory: readonly unknown[]; board: { size: number } },
    metadata?: { blackName?: string; whiteName?: string },
  ): Promise<string | null> {
    const blackName = metadata?.blackName ?? '黑方';
    const whiteName = metadata?.whiteName ?? '白方';
    const size = state.board.size;
    // 1. 构造归档 URL：archive:<base64>?black=...&white=...&size=...
    const archiveUrl = this.buildArchiveUrl(sgf, blackName, whiteName, size);
    // 2. 调用 gameService.fetch 归档
    const result = await this.gameService.fetch(archiveUrl);
    if (!result.success || !result.archiveId) {
      console.warn('归档失败', { error: result.error });
      return null;
    }
    // 3. 存储 archiveId 到 FavoriteService
    const favoriteId = await this.favoriteService.addFavorite(
      this.category,
      result.archiveId,
      { blackName, whiteName, moveCount: state.moveHistory.length, size },
      `${blackName} vs ${whiteName}`,
    );
    return favoriteId;
  }
  /** 查询棋谱历史 */
  async queryHistory(options?: RecorderHistoryOptions): Promise<RecorderHistoryEntry[]> {
    const favorites = await this.favoriteService.getFavorites({
      category: this.category,
    });
    // TODO: 支持关键字过滤（需要在 favoriteService 中实现）
    // 手动限制数量
    const limit = options?.limit ?? 20;
    const limitedFavorites = favorites.slice(0, limit);
    return limitedFavorites.map((f: IFavoriteItem) => ({
      id: f.id,
      blackName: (f.data?.['blackName'] as string) ?? '',
      whiteName: (f.data?.['whiteName'] as string) ?? '',
      moveCount: (f.data?.['moveCount'] as number) ?? 0,
      createdAt: f.createdAt,
    }));
  }
  /** 获取历史棋谱详情 */
  async getHistoryDetail(id: string): Promise<RecorderHistoryDetail | null> {
    const favorite = await this.favoriteService.getById(id);
    if (!favorite) return null;
    const archiveId = favorite.key;
    const sgf = await this.gameService.getByArchiveId(archiveId);
    return {
      id: favorite.id,
      blackName: (favorite.data?.['blackName'] as string) ?? '',
      whiteName: (favorite.data?.['whiteName'] as string) ?? '',
      moveCount: (favorite.data?.['moveCount'] as number) ?? 0,
      size: (favorite.data?.['size'] as number) ?? 19,
      sgf: sgf ?? '',
      createdAt: favorite.createdAt,
    };
  }
  /** 清空历史 */
  async clearHistory(): Promise<void> {
    await this.favoriteService.clear(this.category);
  }
  /** 获取统计 */
  async getStats(): Promise<RecorderStats> {
    const total = await this.favoriteService.count(this.category);
    // today 暂不支持（需要时间范围查询）
    return { total, today: 0 };
  }
  // ===== 私有方法 =====
  /**
   * 构造归档 URL
   * @description archive:<base64>?black=黑方&white=白方&size=19
   */
  private buildArchiveUrl(
    sgf: string,
    blackName: string,
    whiteName: string,
    size: number,
  ): string {
    // Base64 编码（URL 安全，兼容浏览器和 Node.js）
    const encoded = this.encodeBase64(sgf)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const params = new URLSearchParams({
      black: blackName,
      white: whiteName,
      size: String(size),
    });
    return `archive:${encoded}?${params.toString()}`;
  }
  /**
   * Base64 编码（兼容浏览器和 Node.js，支持 Unicode）
   */
  private encodeBase64(str: string): string {
    // 先将 Unicode 转为 Latin1 字节序列，再 btoa
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16)),
      ),
    );
  }
}
