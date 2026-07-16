/**
 * 对手分析的棋谱列表提供者
 * @description 从 opponent 收藏数据获取棋谱归档 ID 列表
 */
import type { IFavoriteService } from '../../../../../services/favorite';
import type { IGameListProvider } from './IGameListProvider';
export class OpponentGameListProvider implements IGameListProvider {
  readonly category = 'opponent';
  constructor(private readonly favoriteService: IFavoriteService) {}
  async getGameArchiveIds(key: string): Promise<string[]> {
    const item = await this.favoriteService.getFavorite('opponent', key);
    if (!item || !item.data || !item.data['games']) {
      return [];
    }
    const games = item.data['games'] as Array<{ archiveId: string }>;
    return games.map(g => g.archiveId);
  }
}
