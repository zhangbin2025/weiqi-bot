/**
 * @fileoverview 手谈类型定义
 */

/**
 * 手谈 API 响应
 */
export interface ShoutanApiResponse {
  code: number;
  msg?: string;
  data: ShoutanGameData;
}

/**
 * 手谈游戏数据
 */
export interface ShoutanGameData {
  id: number;
  date?: string;
  event?: string;
  result?: string;
  winner?: string;
  yml: string;
  black?: { name?: string };
  white?: { name?: string };
}

/**
 * 手谈元数据
 */
export interface ShoutanMetadata {
  /** 游戏ID */
  kifuId: string;
  /** 黑方名称 */
  blackName: string;
  /** 白方名称 */
  whiteName: string;
  /** 棋盘大小 */
  boardSize: string;
  /** 对局事件 */
  event?: string;
  /** 对局日期 */
  date?: string;
  /** 结果 */
  result?: string;
}