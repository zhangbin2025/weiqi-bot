import type { PlayerColor } from '../primitives';
import type { IBoard } from '../board';

/**
 * 自杀规则接口
 * @ai-example
 * const rule: ISuicideRule = { isSuicide: () => false };
 */
export interface ISuicideRule {
  /**
   * 检查落子是否为自杀
   * @param board - 棋盘
   * @param x - 落子 X 坐标
   * @param y - 落子 Y 坐标
   * @param color - 落子颜色
   * @returns 是否为自杀（禁入点）
   */
  isSuicide(board: IBoard, x: number, y: number, color: PlayerColor): boolean;
}