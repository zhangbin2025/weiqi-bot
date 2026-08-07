/**
 * @fileoverview 1919围棋类型定义
 */

/**
 * 1919围棋元数据
 */
export interface Weiqi1919Metadata {
  /** 棋谱 ID */
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
  /** 对局名称 */
  gameName: string;
  /** 对局日期 */
  date: string;
  /** 棋盘大小 */
  boardSize: number;
  /** 贴目 */
  komi: number;
  /** 着法数 */
  movesCount: number;
}
