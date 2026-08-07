import type { PlayerColor } from '../primitives';
import type { PositionState } from './IPosition';

/**
 * 棋盘接口
 * @ai-example
 * const board: IBoard = { size: 19, positions: [...], getStone: () => 'black' };
 */
export interface IBoard {
  /** 棋盘大小 */
  readonly size: number;
  /**
   * 获取指定位置的棋子颜色
   * @param x - X 坐标
   * @param y - Y 坐标
   * @returns 棋子颜色或 null（空）
   */
  getStone(x: number, y: number): PlayerColor | null;
  /**
   * 设置指定位置的棋子
   * @param x - X 坐标
   * @param y - Y 坐标
   * @param color - 棋子颜色或 null（清除）
   */
  setStone(x: number, y: number, color: PlayerColor | null): void;
  /**
   * 检查坐标是否有效
   * @param x - X 坐标
   * @param y - Y 坐标
   * @returns 是否有效
   */
  isValidPosition(x: number, y: number): boolean;
  /**
   * 克隆棋盘
   * @returns 新棋盘
   */
  clone(): IBoard;

  /**
   * 获取指定位置的棋子颜色（别名）
   * @param x - X 坐标
   * @param y - Y 坐标
   * @returns 棋子颜色或 null
   */
  getPoint(x: number, y: number): PlayerColor | null;
}

/**
 * 棋盘状态类型（二维数组）
 * board[y][x] 表示第 y 行第 x 列的棋子状态
 */
export type BoardState = PositionState[][];

/**
 * 创建空棋盘状态
 * @param size - 棋盘大小
 * @returns 空棋盘状态
 * @ai-example
 * createEmptyBoardState(19); // [[null, null, ...], ...]
 */
export function createEmptyBoardState(size: number): BoardState {
  const board: BoardState = [];
  for (let y = 0; y < size; y++) {
    board[y] = [];
    for (let x = 0; x < size; x++) {
      board[y]![x] = null;
    }
  }
  return board;
}