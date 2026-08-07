import type { ICoordinate } from '../coordinate';
import type { PlayerColor } from '../primitives';
import type { IBoard } from '../board';

/**
 * 棋子群接口（连通块）
 * @ai-example
 * const group: IStoneGroup = {
 *   stones: [{ x: 3, y: 3, color: 'black' }],
 *   liberties: [{ x: 2, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 4 }]
 * };
 */
export interface IStoneGroup {
  /** 棋子列表 */
  readonly stones: readonly ICoordinate[];
  /** 棋子颜色 */
  readonly color: PlayerColor;
}

/**
 * 气计算器接口
 * @ai-example
 * const calculator: ILibertyCalculator = { countLiberties: () => 4 };
 */
export interface ILibertyCalculator {
  /**
   * 计算指定棋子群的气数
   * @param board - 棋盘
   * @param x - 起始 X 坐标
   * @param y - 起始 Y 坐标
   * @returns 气数
   */
  countLiberties(board: IBoard, x: number, y: number): number;
  /**
   * 获取指定棋子群的气位列表
   * @param board - 棋盘
   * @param x - 起始 X 坐标
   * @param y - 起始 Y 坐标
   * @returns 气位坐标列表
   */
  getLiberties(board: IBoard, x: number, y: number): ICoordinate[];
  /**
   * 查找连通块
   * @param board - 棋盘
   * @param x - 起始 X 坐标
   * @param y - 起始 Y 坐标
   * @returns 棋子群
   */
  findGroup(board: IBoard, x: number, y: number): IStoneGroup;
}