/**
 * @fileoverview 弈客围棋类型定义
 */

/**
 * 弈客围棋元数据
 */
export interface YikeMetadata {
  /** 房间 ID */
  roomId: string;
  /** 黑方名称 */
  blackName: string;
  /** 白方名称 */
  whiteName: string;
  /** 对局名称 */
  gameName: string;
  /** 着法数 */
  movesCount: number;
  /** 对局结果 */
  result: string;
  /** 对局日期 */
  date: string;
}
