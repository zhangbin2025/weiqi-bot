/**
 * 已读标记类型定义
 */

/** 已读标记存储结构 */
export interface ReadMarkStorage {
  /** 已读ID列表 */
  ids: string[];
  /** 最后更新时间 */
  updatedAt: number;
}

/** 已读标记分类常量 */
export const READ_MARK_CATEGORIES = {
  /** 对手分析棋谱 */
  OPPONENT_GAMES: 'opponent:games',
  /** 对手分析定式 */
  OPPONENT_JOSEKI: 'opponent:joseki',
  /** 下载历史棋谱 */
  FETCHER_GAMES: 'fetcher:games',
  /** 棋手棋谱 */
  PLAYER_GAMES: 'player:games',
} as const;

export type ReadMarkCategory = typeof READ_MARK_CATEGORIES[keyof typeof READ_MARK_CATEGORIES];
