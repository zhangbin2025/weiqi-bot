/**
 * 复盘棋谱列表提供者
 * @description 从 review_data 收藏数据获取棋谱归档 ID 列表
 */
import type { IFavoriteService } from '@/services/favorite';
import type { IGameListProvider } from './IGameListProvider';
/**
 * 复盘棋谱列表提供者
 * @description 从复盘收藏数据获取棋谱归档 ID 列表
 */
export class ReviewGameListProvider implements IGameListProvider {
  readonly category = 'review';
  constructor(private readonly favoriteService: IFavoriteService) {}
  async getGameArchiveIds(key: string): Promise<string[]> {
    // 如果 key 参数是 'all'，返回所有复盘收藏
    if (key === 'all') {
      const favorites = await this.favoriteService.getFavorites({ category: 'review_data' });
      return favorites.map(f => f.key);
    }
    // 否则按 key 查询单个收藏
    const favorite = await this.favoriteService.getFavorite('review_data', key);
    if (!favorite) return [];
    return [favorite.key]; // key = archiveId
  }
}
