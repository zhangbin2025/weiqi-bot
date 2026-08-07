/**
 * @fileoverview 弈城围棋类型定义
 */

/**
 * 弈城 API 响应（文本格式）
 */

/**
 * 弈城元数据
 */
export interface YichengMetadata {
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
  /** 对局日期 */
  date: string;
  /** 着法数 */
  movesCount: number;
}