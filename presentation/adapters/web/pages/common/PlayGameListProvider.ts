/**
 * 对弈棋谱列表提供者
 * @description 从 play 收藏数据获取棋谱归档 ID 列表
 */
import type { IFavoriteService } from '@/services/favorite';
import type { IGameListProvider } from './IGameListProvider';
/**
 * 对弈棋谱列表提供者
 * @description 从 play 收藏数据获取棋谱归档 ID 列表
 * 包括：MM（AI自对弈）、HM（人机对弈）、HH（真人对弈）
 */
export class PlayGameListProvider implements IGameListProvider {
  readonly category = 'play';
  constructor(private readonly favoriteService: IFavoriteService) {}
  async getGameArchiveIds(key: string): Promise<string[]> {
    // 如果 key 参数是 'all'，返回所有 play 收藏
    if (key === 'all') {
      const favorites = await this.favoriteService.getFavorites({ category: 'play' });
      return favorites.map(f => f.key);
    }
    // 否则按 key 查询单个收藏
    const favorite = await this.favoriteService.getFavorite('play', key);
    if (!favorite) return [];
    return [favorite.key]; // key = archiveId
  }
}
