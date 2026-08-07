/**
 * 棋盘事件类型定义
 */
import type { Position } from './board';
/** 棋盘事件回调 */
export interface IBoardEvents {
  /** 点击事件 */
  onClick?: (pos: Position) => void;
  /** 悬停事件 */
  onHover?: (pos: Position) => void;
  /** 移动事件 */
  onMove?: (from: Position, to: Position) => void;
}
