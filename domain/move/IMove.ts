import type { PlayerColor } from '../primitives';
import type { ICoordinate } from '../coordinate';

/**
 * 着法类型
 * @ai-example
 * const move: IMove = { x: 3, y: 3, color: 'black', number: 1 };
 */
export interface IMove {
  /** X 坐标 */
  readonly x: number;
  /** Y 坐标 */
  readonly y: number;
  /** 棋子颜色 */
  readonly color: PlayerColor;
  /** 手数 */
  readonly number: number;
}

/**
 * 停一手接口
 * @ai-example
 * const pass: IPassMove = { color: 'black', number: 1, isPass: true };
 */
export interface IPassMove {
  /** 棋子颜色 */
  readonly color: PlayerColor;
  /** 手数 */
  readonly number: number;
  /** 是否为停一手 */
  readonly isPass: true;
}

/**
 * 着法或停一手联合类型
 */
export type MoveOrPass = IMove | IPassMove;

/**
 * 创建着法
 * @param x - X 坐标
 * @param y - Y 坐标
 * @param color - 棋子颜色
 * @param number - 手数
 * @returns 着法对象
 * @ai-example
 * createMove(3, 3, 'black', 1); // { x: 3, y: 3, color: 'black', number: 1 }
 */
export function createMove(
  x: number,
  y: number,
  color: PlayerColor,
  number: number
): IMove {
  return { x, y, color, number };
}

/**
 * 创建停一手
 * @param color - 棋子颜色
 * @param number - 手数
 * @returns 停一手对象
 * @ai-example
 * createPassMove('black', 1); // { color: 'black', number: 1, isPass: true }
 */
export function createPassMove(color: PlayerColor, number: number): IPassMove {
  return { color, number, isPass: true };
}

/**
 * 判断是否为停一手
 * @param move - 着法
 * @returns 是否为停一手
 */
export function isPass(move: MoveOrPass): move is IPassMove {
  return 'isPass' in move && move.isPass === true;
}

/**
 * 获取着法的坐标
 * @param move - 着法
 * @returns 坐标或 null（停一手）
 */
export function getMoveCoordinate(move: MoveOrPass): ICoordinate | null {
  if (isPass(move)) return null;
  return { x: move.x, y: move.y };
}