/**
 * @fileoverview izis围棋类型定义
 */

/**
 * izis围棋元数据
 */
export interface IzisMetadata {
  /** 游戏 ID */
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
  /** 棋盘大小 */
  boardSize: number;
  /** 着法数 */
  movesCount: number;
  /** 规则 */
  rules: string;
}
