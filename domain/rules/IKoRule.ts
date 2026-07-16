import type { IBoard } from '../board';
import type { ICoordinate } from '../coordinate';

/**
 * 打劫状态接口
 * @ai-example
 * const koState: IKoState = {
 *   forbiddenPosition: { x: 3, y: 3 },
 *   isActive: true
 * };
 */
export interface IKoState {
  /** 禁止立即落子的位置（劫材位） */
  readonly forbiddenPosition: ICoordinate | null;
  /** 是否处于打劫状态 */
  readonly isActive: boolean;
}

/**
 * 打劫规则接口
 * @ai-example
 * const rule: IKoRule = { checkKo: () => ({ forbiddenPosition: null, isActive: false }) };
 */
export interface IKoRule {
  /**
   * 检查是否违反打劫规则
   * @param board - 当前棋盘
   * @param previousBoard - 前一状态的棋盘
   * @param x - 落子 X 坐标
   * @param y - 落子 Y 坐标
   * @returns 是否违反打劫规则
   */
  isKoViolation(board: IBoard, previousBoard: IBoard | null, x: number, y: number): boolean;
  /**
   * 检测是否形成打劫
   * @param board - 当前棋盘
   * @param capturedCount - 提子数量
   * @param capturedPosition - 被提子的位置
   * @returns 打劫状态
   */
  detectKo(board: IBoard, capturedCount: number, capturedPosition: ICoordinate): IKoState;
}