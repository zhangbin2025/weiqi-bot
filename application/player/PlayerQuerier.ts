/**
 * 棋手查询编排器
 * @description Application 层编排器，组合 PlayerService、FavoriteService 完成棋手查询
 */
import type { IPlayerService, PlayerQueryResult } from '../../services/player';
import type { IFavoriteService, IFavoriteItem } from '../../services/favorite';
import type { IPlayerQuerier } from './IPlayerQuerier';
/** 查询选项 */
export interface PlayerQueryOptions {
  /** 是否跳过缓存 */
  forceRefresh?: boolean;
}
/** 棋手收藏条目 */
export interface PlayerBookmark {
  id: string;
  name: string;
  result?: PlayerQueryResult | undefined;
  updatedAt: number;
}
/** 查询结果（带收藏 ID） */
export interface PlayerQueryResultWithBookmark extends PlayerQueryResult {
  /** 收藏 ID */
  bookmarkId?: string | undefined;
}
/**
 * 棋手查询编排器
 * @description 组合 PlayerService、FavoriteService 完成棋手查询
 */
export class PlayerQuerier implements IPlayerQuerier {
  constructor(
    private readonly playerService: IPlayerService,
    private readonly favoriteService?: IFavoriteService,
  ) {}
  /**
   * 查询棋手信息
   */
  async query(name: string, options?: PlayerQueryOptions): Promise<PlayerQueryResultWithBookmark> {
    // 1. 调用 PlayerService 查询
    const result = await this.playerService.query(name);
    // 2. 查到结果时才添加收藏
    let bookmarkId: string | undefined;
    const found = (result.shoutan.found && result.shoutan.players.length > 0)
      || (result.yichafen.found && result.yichafen.data);
    if (found && this.favoriteService) {
      bookmarkId = await this.favoriteService.addFavorite(
        'player',
        name,
        { name, result }
      );
    }
    return { ...result, bookmarkId };
  }
  /**
   * 获取棋手收藏列表
   */
  async getFavorites(): Promise<PlayerBookmark[]> {
    if (!this.favoriteService) return [];
    const items = await this.favoriteService.getFavorites({ category: 'player' });
    return items.map((item: IFavoriteItem) => ({
      id: item.id,
      name: (item.data?.['name'] as string) ?? item.key,
      result: item.data?.['result'] as PlayerQueryResult | undefined,
      updatedAt: item.createdAt,
    }));
  }
  /**
   * 清空棋手收藏
   */
  async clearFavorites(): Promise<void> {
    await this.favoriteService?.clear('player');
  }
}
