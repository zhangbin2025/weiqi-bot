/**
 * 缩略图类型定义
 * @module presentation/adapters/web/components/types
 */
import type { PlayerColor } from '../../../../domain/primitives';
/** 着法数据 */
export interface ThumbnailMove {
  x: number;
  y: number;
  color: PlayerColor;
  isPass?: boolean;
}
/** 缩略图配置选项 */
export interface ThumbnailOptions {
  /** 背景色（默认使用 theme） */
  bgColor?: string | undefined;
  /** 显示路数（默认 13） */
  displaySize?: number | undefined;
  /** 设备像素比（自动检测，最大 2） */
  dpr?: number | undefined;
  /** 截断着法数（只显示前 N 手） */
  prefixLen?: number | undefined;
  /** 棋盘主题 */
  theme?: 'classic' | 'wooden' | 'modern' | undefined;
}
/** 棋盘状态类型 */
export type BoardState = (PlayerColor | null)[][];
/** 棋盘常量 */
export const BOARD_SIZE = 19;
