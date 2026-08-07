import type { ICoordinate } from './ICoordinate';

/**
 * 坐标转换器接口
 * @ai-example
 * const converter = new CoordinateConverter(19);
 * converter.sgfToCoordinate('dd'); // { x: 3, y: 3 }
 */
export interface ICoordinateConverter {
  /** 棋盘大小 */
  readonly boardSize: number;
  /**
   * SGF 坐标转数字坐标
   * @param sgf - SGF 坐标（如 'dd'）
   * @returns 数字坐标
   */
  sgfToCoordinate(sgf: string): ICoordinate;
  /**
   * 数字坐标转 SGF 坐标
   * @param coord - 数字坐标
   * @returns SGF 坐标
   */
  coordinateToSGF(coord: ICoordinate): string;
  /**
   * 数字坐标转显示坐标（如 'D4'）
   * @param coord - 数字坐标
   * @returns 显示坐标
   */
  coordinateToDisplay(coord: ICoordinate): string;
  /**
   * 显示坐标转数字坐标
   * @param display - 显示坐标（如 'D4'）
   * @returns 数字坐标
   */
  displayToCoordinate(display: string): ICoordinate | null;
}