/**
 * 缩略图服务类型定义
 * @module services/thumbnail/types
 */

import type { PlayerColor } from '../../domain/primitives';

/** 着法数据 */
export interface ThumbnailMove {
  x: number;
  y: number;
  color: PlayerColor;
  isPass?: boolean;
}

/** 着法数据格式 */
export interface ThumbnailMoveData {
  /** JSON 数组字符串 */
  json?: string;
  /** SGF 格式 */
  sgf?: string;
  /** 坐标字符串 */
  coords?: string;
}
