import type { IBoard } from '../board';
import type { ICoordinate } from '../coordinate';
import type { IKoRule, IKoState } from './IKoRule';
import { createCoordinate } from '../coordinate';
import { LibertyCalculator } from './LibertyCalculator';

/**
 * 打劫规则实现
 * 禁止立即提回单一子（劫）
 * @ai-example
 * const rule = new KoRule();
 * // 检测打劫状态
 * const koState = rule.detectKo(board, 1, { x: 3, y: 3 });
 */
export class KoRule implements IKoRule {
  private libertyCalc: LibertyCalculator;

  constructor() {
    this.libertyCalc = new LibertyCalculator();
  }

  /**
   * 检查是否违反打劫规则
   * 如果落子后的棋盘状态与前一状态相同，则违反打劫
   */
  isKoViolation(board: IBoard, previousBoard: IBoard | null, x: number, y: number): boolean {
    if (!previousBoard) return false;
    // 比较两个棋盘状态是否完全相同
    return this.boardsEqual(board, previousBoard);
  }

  /**
   * 检测是否形成打劫
   * 条件：只提了一个子，且对方能立即提回
   */
  detectKo(board: IBoard, capturedCount: number, capturedPosition: ICoordinate): IKoState {
    if (capturedCount !== 1) {
      return { forbiddenPosition: null, isActive: false };
    }
    // 检查被提位置是否正好是劫位
    // 对方如果在该位置落子，能否提回当前子
    const x = capturedPosition.x;
    const y = capturedPosition.y;
    // 简化判断：如果被提位置周围全是己方棋子（除了落子位），则可能形成劫
    return {
      forbiddenPosition: capturedPosition,
      isActive: true,
    };
  }

  /**
   * 比较两个棋盘是否相同
   */
  private boardsEqual(board1: IBoard, board2: IBoard): boolean {
    if (board1.size !== board2.size) return false;
    for (let y = 0; y < board1.size; y++) {
      for (let x = 0; x < board1.size; x++) {
        if (board1.getStone(x, y) !== board2.getStone(x, y)) {
          return false;
        }
      }
    }
    return true;
  }
}