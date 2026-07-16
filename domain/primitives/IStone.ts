import type { PlayerColor } from './IPlayer';

/**
 * 棋子接口
 * @ai-example
 * const stone: IStone = { x: 3, y: 3, color: 'black' };
 */
export interface IStone {
  /** X 坐标 (0-18) */
  readonly x: number;
  /** Y 坐标 (0-18) */
  readonly y: number;
  /** 棋子颜色 */
  readonly color: PlayerColor;
}

/**
 * 创建棋子
 * @param x - X 坐标
 * @param y - Y 坐标
 * @param color - 棋子颜色
 * @returns 棋子对象
 * @ai-example
 * createStone(3, 3, 'black'); // { x: 3, y: 3, color: 'black' }
 */
export function createStone(x: number, y: number, color: PlayerColor): IStone {
  return { x, y, color };
}

/**
 * 判断两个棋子是否在同一位置
 * @param stone1 - 第一个棋子
 * @param stone2 - 第二个棋子
 * @returns 是否在同一位置
 * @ai-example
 * isSamePosition({ x: 3, y: 3, color: 'black' }, { x: 3, y: 3, color: 'white' }); // true
 */
export function isSamePosition(stone1: IStone, stone2: IStone): boolean {
  return stone1.x === stone2.x && stone1.y === stone2.y;
}

/**
 * 判断两个棋子是否完全相同（位置和颜色）
 * @param stone1 - 第一个棋子
 * @param stone2 - 第二个棋子
 * @returns 是否完全相同
 * @ai-example
 * isSameStone({ x: 3, y: 3, color: 'black' }, { x: 3, y: 3, color: 'black' }); // true
 */
export function isSameStone(stone1: IStone, stone2: IStone): boolean {
  return isSamePosition(stone1, stone2) && stone1.color === stone2.color;
}

/**
 * 获取棋子的唯一键值
 * @param stone - 棋子
 * @returns 唯一键值 "x,y"
 * @ai-example
 * getStoneKey({ x: 3, y: 3, color: 'black' }); // "3,3"
 */
export function getStoneKey(stone: IStone): string {
  return `${stone.x},${stone.y}`;
}
