/**
 * @fileoverview 弈客少儿类型定义
 */

/**
 * 弈客少儿 API 响应
 */
export interface YikeShaoerApiResponse {
  code: string;
  aiResultList: YikeShaoerGameData[];
}

/**
 * 弈客少儿游戏数据
 */
export interface YikeShaoerGameData {
  sgfContent: string;
  blackBy?: string;
  whiteBy?: string;
  blackDan?: string;
  whiteDan?: string;
  sgfResult?: string;
  chessTime?: string;
  handsCount?: number;
  room?: string;
}

/**
 * 弈客少儿元数据
 */
export interface YikeShaoerMetadata {
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
  /** 结果 */
  result: string;
  /** 日期 */
  date: string;
  /** 着法数 */
  movesCount: number;
  /** 房间 ID */
  roomId: string;
}