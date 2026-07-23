/**
 * @fileoverview 通用类型定义
 */

/**
 * 性能计时信息
 */
export interface PerformanceTiming {
  /** 提取 ID 耗时（毫秒） */
  extractId?: number;
  /** API 请求耗时（毫秒） */
  apiRequest?: number;
  /** 认证请求耗时（毫秒） */
  authRequest?: number;
  /** Token请求耗时（毫秒） */
  tokenRequest?: number;
  /** 浏览器请求耗时（毫秒） */
  browserRequest?: number;
  /** SGF 生成耗时（毫秒） */
  sgfGeneration?: number;
  /** 总耗时（毫秒） */
  total?: number;
}

/**
 * 游戏元数据
 */
export interface GameMetadata {
  /** 游戏来源标识 */
  source: string;
  /** 游戏唯一标识 */
  gameId: string;
  /** 黑方名字 */
  blackName: string;
  /** 白方名字 */
  whiteName: string;
  /** 黑方段位 */
  blackRank?: string;
  /** 白方段位 */
  whiteRank?: string;
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
  result?: string;
  /** 手数 */
  movesCount: number;
  /** 是否为直播棋谱 */
  isLive?: boolean;
  /** 对局是否已结束（直播棋谱专用） */
  isEnded?: boolean;
}

/**
 * 下载结果
 */
export interface FetchResult {
  /** 是否成功 */
  success: boolean;
  /** 来源标识 */
  source: string;
  /** 原始 URL */
  url: string;
  /** SGF 内容 */
  sgfContent: string | null;
  /** 游戏元数据 */
  metadata: GameMetadata;
  /** 错误信息 */
  error?: string | undefined;
  /** 性能计时 */
  timing?: PerformanceTiming | undefined;
}
