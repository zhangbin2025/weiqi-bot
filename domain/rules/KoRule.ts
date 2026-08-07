import type { IBoard } from '../board';
import type { ICoordinate } from '../coordinate';
import type { PlayerColor } from '../primitives';
import type { IKoRule, IKoState } from './IKoRule';
import { createCoordinate } from '../coordinate';
import { LibertyCalculator } from './LibertyCalculator';
import { CaptureRule } from './CaptureRule';

/**
 * 打劫规则实现
 * 禁止立即提回单一子（劫）
 *
 * 劫的判定条件（全部满足）：
 * 1. 本方只提了 1 子
 * 2. 对方在被提位置落子后，也恰好只能提回 1 子
 * 这样就排除了"打二还一"等场景——对方提回多于1子时不会形成循环
 */
export class KoRule implements IKoRule {
  private libertyCalc: LibertyCalculator;
  private captureRule: CaptureRule;

  constructor() {
    this.libertyCalc = new LibertyCalculator();
    this.captureRule = new CaptureRule();
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
   * 条件（全部满足才是劫）：
   * 1. 本方只提了 1 子
   * 2. 对方在被提位置落子后，也恰好只能提回 1 子
   * 这排除了"打二还一"等场景——对方提回多于1子时不会形成循环
   */
  detectKo(board: IBoard, capturedCount: number, capturedPosition: ICoordinate, currentPlayer: PlayerColor): IKoState {
    if (capturedCount !== 1) {
      return { forbiddenPosition: null, isActive: false };
    }

    // 模拟对方在被提位置落子，检查对方能提几子
    // 如果对方能提回多于 1 子，则不是劫（打二还一等情况）
    const opponentColor: PlayerColor = currentPlayer === 'black' ? 'white' : 'black';
    const simBoard = board.clone();
    simBoard.setStone(capturedPosition.x, capturedPosition.y, opponentColor);
    const opponentCapture = this.captureRule.capture(simBoard, capturedPosition.x, capturedPosition.y, opponentColor);

    if (opponentCapture.count !== 1) {
      // 对方提不回恰好1子（提0子或提多于1子），不是劫
      return { forbiddenPosition: null, isActive: false };
    }

    // 对方只能提回恰好1子，形成劫
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
