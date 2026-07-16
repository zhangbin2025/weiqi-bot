/**
 * @fileoverview 腾讯围棋类型定义
 */

/**
 * 腾讯围棋元数据
 */
export interface TxwqMetadata {
  /** 对局 ID */
  gameId: string;
  /** 黑方名称 */
  blackName: string;
  /** 白方名称 */
  whiteName: string;
  /** 黑方段位 */
  blackRank: string;
  /** 白方段位 */
  whiteRank: string;
  /** 对局结果 */
  result: string;
  /** 对局日期 */
  date: string;
  /** 着法数 */
  movesCount: number;
}
