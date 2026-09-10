/**
 * @fileoverview Remote Provider 类型定义
 * @description 远程抓取 RPC 请求/响应类型
 */

/**
 * fetch RPC 请求参数
 */
export interface RemoteFetchRequest {
  /** 棋谱页面 URL */
  url: string;
}

/**
 * fetch RPC 响应数据
 */
export interface RemoteFetchResponse {
  /** 是否成功 */
  success: boolean;
  /** SGF 内容 */
  sgfContent: string | null;
  /** 来源标识 */
  source: string;
  /** 游戏元数据 */
  metadata: {
    source: string;
    gameId: string;
    blackName: string;
    whiteName: string;
    blackRank?: string;
    whiteRank?: string;
    width: number;
    height: number;
    komi: number;
    handicap: number;
    rules: string;
    date: string;
    result?: string;
    movesCount: number;
    isLive?: boolean;
    isEnded?: boolean;
  };
  /** 错误信息 */
  error?: string;
}
