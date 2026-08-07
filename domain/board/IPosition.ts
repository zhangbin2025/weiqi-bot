import type { PlayerColor } from '../primitives';

/**
 * 位置状态类型
 * - null - 空
 * - 'black' - 黑子
 * - 'white' - 白子
 */
export type PositionState = PlayerColor | null;

/**
 * 位置接口
 * @ai-example
 * const pos: IPosition = { x: 3, y: 3, state: 'black' };
 */
export interface IPosition {
  /** X 坐标 */
  readonly x: number;
  /** Y 坐标 */
  readonly y: number;
  /** 位置状态 */
  readonly state: PositionState;
}

/**
 * 创建位置
 * @param x - X 坐标
 * @param y - Y 坐标
 * @param state - 位置状态
 * @returns 位置对象
 * @ai-example
 * createPosition(3, 3, 'black'); // { x: 3, y: 3, state: 'black' }
 */
export function createPosition(
  x: number,
  y: number,
  state: PositionState = null
): IPosition {
  return { x, y, state };
}

/**
 * 判断位置是否为空
 * @param position - 位置
 * @returns 是否为空
 * @ai-example
 * isEmptyPosition({ x: 3, y: 3, state: null }); // true
 */
export function isEmptyPosition(position: IPosition): boolean {
  return position.state === null;
}

/**
 * 判断位置是否有指定颜色的棋子
 * @param position - 位置
 * @param color - 颜色
 * @returns 是否有指定颜色的棋子
 * @ai-example
 * hasStone({ x: 3, y: 3, state: 'black' }, 'black'); // true
 */
export function hasStone(position: IPosition, color: PlayerColor): boolean {
  return position.state === color;
}