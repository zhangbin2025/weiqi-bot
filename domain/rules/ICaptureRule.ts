import type { PlayerColor } from '../primitives';
import type { IBoard } from '../board';
import type { ICoordinate } from '../coordinate';

/**
 * 提子结果接口
 * @ai-example
 * const result: ICaptureResult = { captured: [{ x: 3, y: 3 }], count: 1 };
 */
export interface ICaptureResult {
  /** 被提的棋子坐标列表 */
  readonly captured: readonly ICoordinate[];
  /** 被提的棋子数量 */
  readonly count: number;
}

/**
 * 提子规则接口
 * @ai-example
 * const rule: ICaptureRule = { capture: () => ({ captured: [], count: 0 }) };
 */
export interface ICaptureRule {
  /**
   * 执行提子判定
   * @param board - 棋盘
   * @param x - 落子 X 坐标
   * @param y - 落子 Y 坐标
   * @param color - 落子颜色
   * @returns 提子结果
   */
  capture(board: IBoard, x: number, y: number, color: PlayerColor): ICaptureResult;
}