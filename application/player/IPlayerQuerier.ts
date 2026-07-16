/**
 * 棋手查询编排器接口
 * @module application/player/IPlayerQuerier
 *
 * Page 层依赖此接口而非 PlayerQuerier 具体类。
 */
import type { PlayerQueryResultWithBookmark, PlayerBookmark, PlayerQueryOptions } from './PlayerQuerier';
export interface IPlayerQuerier {
  /** 查询棋手信息 */
  query(name: string, options?: PlayerQueryOptions): Promise<PlayerQueryResultWithBookmark>;
  /** 获取棋手收藏列表 */
  getFavorites(): Promise<PlayerBookmark[]>;
  /** 清空棋手收藏 */
  clearFavorites(): Promise<void>;
}
