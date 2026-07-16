/**
 * 文本棋盘渲染配置
 */
export interface TextBoardConfig {
  /** 棋盘大小（默认 19） */
  size?: number;
  /** 是否显示坐标（默认 true） */
  showCoordinates?: boolean;
  /** 是否显示手数（默认 false） */
  showMoveNumbers?: boolean;
  /** 最后一手位置（用于高亮） */
  lastMove?: { x: number; y: number };
}
/**
 * 文本棋盘符号配置
 */
export interface TextBoardSymbols {
  /** 黑子 */
  black: string;
  /** 白子 */
  white: string;
  /** 空位 */
  empty: string;
  /** 黑子（最后一手高亮） */
  blackLast: string;
  /** 白子（最后一手高亮） */
  whiteLast: string;
  /** 星位 */
  starPoint: string;
}
/**
 * 缩略图配置
 */
export interface ThumbnailConfig {
  /** 棋盘大小（默认 19，缩略图可能裁剪） */
  size?: number;
  /** 区域裁剪：只显示有棋子周围的区域，留 margin 格 */
  cropMargin?: number;
  /** 最大尺寸（裁剪后不超过此值） */
  maxSize?: number;
  /** 最后一手位置（用于高亮） */
  lastMove?: { x: number; y: number };
}
/**
 * 缩略图结果
 */
export interface ThumbnailResult {
  /** 文本缩略图 */
  text: string;
  /** 裁剪区域信息 */
  region?: { startX: number; startY: number; endX: number; endY: number };
  /** 附注信息（如着法、胜率等） */
  caption?: string;
}
