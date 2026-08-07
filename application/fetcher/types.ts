/**
 * 棋谱抓取类型定义
 * @module application/fetcher/types
 */

/** 抓取选项 */
export interface FetcherFetchOptions {
  /** 直播模式（不添加收藏） */
  live?: boolean;
}

/** 下载结果 */
export interface FetcherResult {
  /** 是否成功 */
  success: boolean;
  /** 归档ID */
  archiveId?: string;
  /** 来源标识 */
  source: string;
  /** 原始 URL */
  url: string;
  /** 收藏 ID */
  bookmarkId?: string;
  /** 元数据 */
  metadata: {
    black: string;
    white: string;
    result?: string;
    date: string;
    movesCount: number;
    /** 是否为直播棋谱 */
    isLive?: boolean;
    /** 对局是否已结束 */
    isEnded?: boolean;
  };
  /** 是否来自缓存 */
  fromCache: boolean;
  /** 错误信息 */
  error?: string;
}
/** 收藏条目 */
export interface FetcherBookmark {
  id: string;
  url: string;
  archiveId: string;
  source: string;
  black: string;
  white: string;
  result?: string;
  date: string;
  movesCount: number;
    /** 是否为直播棋谱 */
    isLive?: boolean;
    /** 对局是否已结束 */
    isEnded?: boolean;
  updatedAt: number;
}
/** 分享结果 */
export interface ShareResult {
  /** 是否成功 */
  success: boolean;
  /** 分享链接 */
  shareUrl?: string;
  /** 编码后的数据 */
  encodedData?: string | null;
  /** 错误信息 */
  error?: string;
}