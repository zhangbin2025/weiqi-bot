/**
 * @fileoverview 野狐围棋类型定义
 */

/**
 * 野狐用户信息
 */
export interface FoxwqUser {
  /** 用户 UID */
  uid: string;
  /** 昵称 */
  nickname: string;
  /** 段位值（原始值） */
  dan: number;
  /** 总胜局 */
  totalWin: number;
  /** 总负局 */
  totalLost: number;
  /** 总和局 */
  totalEqual: number;
}

/**
 * 野狐棋谱信息
 */
export interface FoxwqGame {
  /** 棋谱 ID */
  chessid: string;
  /** 对局时间 */
  datetime: string;
  /** 黑方昵称 */
  blackNickname: string;
  /** 黑方段位 */
  blackDan: number;
  /** 白方昵称 */
  whiteNickname: string;
  /** 白方段位 */
  whiteDan: number;
  /** 结果类型：1=数子，2=超时，3=中盘，4=认输 */
  resultType: number;
  /** 胜者：0=和棋，1=黑胜，2=白胜 */
  winner: number;
  /** 胜子数 */
  point: number;
  /** 分页编码 */
  code: string;
}

/**
 * 公开棋谱信息
 */
export interface PublicQipu {
  /** 标题 */
  title: string;
  /** 详情页 URL */
  url: string;
  /** 日期 */
  date: string;
}

/**
 * 公开棋谱详情
 */
export interface PublicQipuDetail {
  /** SGF 内容 */
  sgf: string;
  /** 标题 */
  title: string;
  /** 日期 */
  date: string;
}

/**
 * API 响应：用户查询
 */
export interface FoxwqUserResponse {
  /** 结果码：0=成功 */
  result: number;
  /** 错误信息 */
  resultstr?: string;
  errmsg?: string;
  /** 用户 UID */
  uid?: string;
  /** 用户名 */
  username?: string;
  name?: string;
  englishname?: string;
  /** 段位 */
  dan?: number;
  /** 胜局 */
  totalwin?: number;
  /** 负局 */
  totallost?: number;
  /** 和局 */
  totalequal?: number;
}

/**
 * API 响应：棋谱列表
 */
export interface FoxwqChessListResponse {
  /** 结果码：0=成功 */
  result: number;
  /** 错误信息 */
  resultstr?: string;
  /** 棋谱列表 */
  chesslist?: FoxwqGame[];
}

/**
 * API 响应：SGF 下载
 */
export interface FoxwqSgfResponse {
  /** 结果码：0=成功 */
  result: number;
  /** 错误信息 */
  resultstr?: string;
  /** SGF 内容 */
  chess?: string;
}
