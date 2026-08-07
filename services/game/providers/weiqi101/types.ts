/**
 * @fileoverview 101围棋网类型定义
 */

/**
 * 101围棋页面 playInfo 数据
 */
export interface Weiqi101PlayInfo {
  /** 对局 ID */
  id: number;
  /** WebSocket 地址 */
  sockethost?: string;
  sockethost2?: string;
  /** 用户密钥 */
  userkey?: string;
  /** 黑方用户名 */
  busername?: string;
  /** 白方用户名 */
  wusername?: string;
  /** 黑方昵称 */
  black?: string;
  /** 白方昵称 */
  white?: string;
  /** 黑方段位 */
  blacklevelname?: string;
  /** 白方段位 */
  whitelevelname?: string;
  /** 棋盘大小 */
  lu?: number;
  /** 贴目（道） */
  daotiemu?: number;
  /** 让子 */
  rangzi?: number;
  /** 规则：1=中国，2=日本，3=韩国 */
  gamerule?: number;
  /** 手数 */
  step?: number;
  /** 状态：0=进行中，1=已结束 */
  status?: number;
  /** 胜负类型：1=中盘，2=数目 */
  wintype?: number;
  /** 胜子数 */
  winnumber?: number;
  /** 黑方先手 */
  black_first?: boolean;
  /** 着法点列表 */
  points?: string[];
}

/**
 * WebSocket 响应消息
 */
export interface Weiqi101WsMessage {
  /** 动作类型 */
  action?: string;
  /** 数据内容 */
  data?: string;
}

/**
 * WebSocket initdata 数据
 */
export interface Weiqi101InitData {
  /** 着法坐标列表（SGF 格式字符串） */
  pos?: string[];
  /** 对局状态 */
  status?: number;
  /** 手数 */
  stepcount?: number;
}

/**
 * 101围棋元数据
 */
export interface Weiqi101Metadata {
  /** 对局 ID */
  gameId: string;
  /** 黑方名字 */
  blackName: string;
  /** 白方名字 */
  whiteName: string;
  /** 黑方段位 */
  blackRank: string;
  /** 白方段位 */
  whiteRank: string;
  /** 棋盘大小 */
  width: number;
  height: number;
  /** 贴目 */
  komi: number;
  /** 让子 */
  handicap: number;
  /** 规则 */
  rules: string;
  /** 手数 */
  movesCount: number;
  /** 状态 */
  status: string;
  /** 结果 */
  result: string;
}