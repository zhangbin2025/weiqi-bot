/**
 * @fileoverview OGS 类型定义
 */

/**
 * OGS API 响应：游戏数据
 */
export interface OgsGameResponse {
  /** 游戏 ID */
  id: number;
  /** 游戏数据 */
  gamedata: OgsGameData;
  /** 玩家信息 */
  players: {
    black: OgsPlayer;
    white: OgsPlayer;
  };
  /** 开始时间（ISO 字符串） */
  started?: string;
  /** 结束时间（ISO 字符串） */
  ended?: string;
  /** 结果描述 */
  outcome?: string;
  /** 黑方是否输 */
  black_lost?: boolean;
  /** 白方是否输 */
  white_lost?: boolean;
}

/**
 * OGS 游戏数据
 */
export interface OgsGameData {
  /** 棋盘宽度 */
  width: number;
  /** 棋盘高度 */
  height: number;
  /** 贴目 */
  komi: number;
  /** 让子数 */
  handicap: number;
  /** 规则 */
  rules: string;
  /** 着法列表 [[x, y], ...]，(-1, -1) 表示 pass */
  moves: number[][];
}

/**
 * OGS 玩家信息
 */
export interface OgsPlayer {
  /** 用户名 */
  username?: string;
  /** 等级分 */
  ranking?: number;
  /** 段位（字符串形式） */
  rank?: number;
}

/**
 * OGS 游戏元数据
 */
export interface OgsMetadata {
  /** 游戏 ID */
  gameId: string;
  /** 黑方名字 */
  blackName: string;
  /** 白方名字 */
  whiteName: string;
  /** 黑方段位 */
  blackRank: string;
  /** 白方段位 */
  whiteRank: string;
  /** 棋盘宽度 */
  width: number;
  /** 棋盘高度 */
  height: number;
  /** 贴目 */
  komi: number;
  /** 让子数 */
  handicap: number;
  /** 规则 */
  rules: string;
  /** 对局日期 */
  date: string;
  /** 结果 */
  result: string;
  /** 手数 */
  movesCount: number;
}