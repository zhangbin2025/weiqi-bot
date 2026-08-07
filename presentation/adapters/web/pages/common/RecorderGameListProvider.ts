/**
 * 记谱棋谱列表提供者
 * @description 从 recorder 收藏数据获取棋谱归档 ID 列表
 */
import type { IFavoriteService } from '@/services/favorite';
import type { IGameListProvider } from './IGameListProvider';
/**
 * 记谱棋谱列表提供者
 * @description 从 recorder 收藏数据获取棋谱归档 ID 列表
 * 收藏的 key 字段存储的是 archiveId
 */
export class RecorderGameListProvider implements IGameListProvider {
  readonly category = 'recorder';
  constructor(private readonly favoriteService: IFavoriteService) {}
  async getGameArchiveIds(key: string): Promise<string[]> {
    // recorder 的收藏 key 就是 archiveId
    // 如果 key 参数是 'all'，返回所有 recorder 收藏
    if (key === 'all') {
      const favorites = await this.favoriteService.getFavorites({ category: 'recorder' });
      return favorites.map(f => f.key);
    }
    // 否则按 key 查询单个收藏
    const favorite = await this.favoriteService.getFavorite('recorder', key);
    if (!favorite) return [];
    return [favorite.key]; // key = archiveId
  }
}