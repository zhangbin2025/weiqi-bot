import type { PlayerColor } from '../primitives';
import type { IBoard } from '../board';
import type { ISuicideRule } from './ISuicideRule';
import { LibertyCalculator } from './LibertyCalculator';
import { CaptureRule } from './CaptureRule';
import { getOpponentColor } from '../primitives';

/**
 * 自杀规则实现
 * 禁止自杀：落子后己方棋子群无气且不能提对方棋子
 * @ai-example
 * const rule = new SuicideRule();
 * const board = new Board(19);
 * // 设置一个自杀的局面
 * board.setStone(1, 0, 'white');
 * board.setStone(0, 1, 'white');
 * rule.isSuicide(board, 0, 0, 'black'); // true - 这是禁入点
 */
export class SuicideRule implements ISuicideRule {
  private libertyCalc: LibertyCalculator;
  private captureRule: CaptureRule;

  constructor() {
    this.libertyCalc = new LibertyCalculator();
    this.captureRule = new CaptureRule();
  }

  /**
   * 检查落子是否为自杀
   * 逻辑：临时在棋盘上放置棋子，检查是否能提对方棋子或自己有气
   */
  isSuicide(board: IBoard, x: number, y: number, color: PlayerColor): boolean {
    // 该位置必须为空
    if (board.getStone(x, y) !== null) {
      return false; // 已有棋子，不是自杀判定
    }
    // 临时落子（使用克隆棋盘）
    const tempBoard = board.clone();
    tempBoard.setStone(x, y, color);
    // 检查是否能提对方棋子
    const captureResult = this.captureRule.capture(tempBoard, x, y, color);
    if (captureResult.count > 0) {
      return false; // 能提子，不是自杀
    }
    // 检查自己是否有气
    const liberties = this.libertyCalc.countLiberties(tempBoard, x, y);
    return liberties === 0;
  }
}