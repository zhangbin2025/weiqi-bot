/**
 * 研究处理器
 * @description 研究模式：自由试下 + 选点导航（蓝=正解 / 红=非正解）。
 *              用于查看答案与各种变化，不判负。
 */
import type { Game } from '../../../../../../domain/game';
import type { WebBoard } from '../../../components/Board';
import type { TsumegoChecker } from '../../../../../core/helpers/TsumegoChecker';
import type { PuzzlePageState } from '../state/PuzzlePageState';
import type { PuzzlePageUI } from '../ui/PuzzlePageUI';

export interface PuzzleStudyHandlerConfig {
  state: PuzzlePageState;
  ui: PuzzlePageUI;
  game: Game;
  board: WebBoard;
  checker: TsumegoChecker;
  playSound: (type: 'stone' | 'undo') => void;
}

/** 研究处理器 */
export class PuzzleStudyHandler {
  private moves: Array<{ x: number; y: number; color: 'B' | 'W' }> = [];

  constructor(private config: PuzzleStudyHandlerConfig) {}

  /**
   * 进入研究：从 move 0（题目初始局面）开始
   *
   * 做题过程中落下的棋子一律不保留，保证研究从初始局面起算，
   * 这样选点导航也能从第一手开始完整展示正解分支。
   */
  reset(): void {
    this.moves = [];
  }

  getMoves(): Array<{ x: number; y: number; color: 'B' | 'W' }> {
    return [...this.moves];
  }

  /** 是否可回撤 */
  canUndo(): boolean {
    return this.moves.length > 0;
  }

  /**
   * 回撤一手
   * @returns 是否成功（无子可撤时返回 false）
   */
  undo(): boolean {
    if (this.moves.length === 0) return false;
    this.moves.pop();
    this.config.playSound('undo');
    return true;
  }

  /** 自由试下：任意点均可落子，交替颜色 */
  handleBoardClick(x: number, y: number): void {
    const game = this.config.game;
    if (game.getState().board.getStone(x, y) !== null) return;
    const currentPlayer = game.getState().currentPlayer;
    const result = game.placeStone(x, y);
    if (!result.success) return;
    this.moves.push({ x, y, color: currentPlayer === 'black' ? 'B' : 'W' });
    this.config.playSound('stone');
  }
}
