/**
 * 做题处理器
 * @description 交替落子答题：用户落子 → 判定 → 机器按正解分支回应。
 */
import type { Game } from '../../../../../../domain/game';
import type { WebBoard } from '../../../components/Board';
import type { TsumegoChecker } from '../../../../../core/helpers/TsumegoChecker';
import type { PuzzlePageState } from '../state/PuzzlePageState';
import type { PuzzlePageUI } from '../ui/PuzzlePageUI';

/** 一次落子的判定结果 */
export type SolveClickResult = 'ignored' | 'placed' | 'wrong' | 'solved';

/** 已落子（含机器应手），按时间顺序 */
export interface PlayedMove {
  x: number;
  y: number;
  color: 'B' | 'W';
  /** 是否为机器应手 */
  byMachine: boolean;
}

export interface PuzzleSolveHandlerConfig {
  state: PuzzlePageState;
  ui: PuzzlePageUI;
  game: Game;
  board: WebBoard;
  checker: TsumegoChecker;
  playSound: (type: 'stone' | 'correct' | 'wrong' | 'undo') => void;
}

export class PuzzleSolveHandler {
  /** 已落子序列（不含错误手） */
  private moves: PlayedMove[] = [];
  /** 当前答错的一手（仅用于显示；下一手落子或重做时清除） */
  private wrongMove: PlayedMove | null = null;

  constructor(private config: PuzzleSolveHandlerConfig) {}

  /** 进入/重置答题 */
  enterSolve(): void {
    this.moves = [];
    this.wrongMove = null;
    this.config.checker.resetSolve();
  }

  /** 已落子序列（含错误手，供渲染） */
  getMoves(): Array<{ x: number; y: number; color: 'B' | 'W' }> {
    const list = this.moves.map((m) => ({ x: m.x, y: m.y, color: m.color }));
    if (this.wrongMove) list.push({ x: this.wrongMove.x, y: this.wrongMove.y, color: this.wrongMove.color });
    return list;
  }

  /** 用户已落子数（不含机器应手） */
  getUserMoveCount(): number {
    return this.config.checker.getSolveUserMoves();
  }

  /** 处理棋盘点击 */
  handleBoardClick(x: number, y: number): SolveClickResult {
    const game = this.config.game;
    if (game.getState().board.getStone(x, y) !== null) return 'ignored';
    if (this.config.state.get('solved')) return 'ignored';

    // 上一手答错了：清除错误手，接受新的落子
    this.wrongMove = null;

    const currentPlayer = game.getState().currentPlayer;
    const result = game.placeStone(x, y);
    if (!result.success) return 'ignored';

    const userColor: 'B' | 'W' = currentPlayer === 'black' ? 'B' : 'W';
    const solveResult = this.config.checker.solveMove({ x, y, color: userColor });

    if (solveResult.status === 'wrong') {
      // 答错：仅做视觉呈现，不推进判定状态（checker 也不压栈）
      this.wrongMove = { x, y, color: userColor, byMachine: false };
      return 'wrong';
    }

    this.moves.push({ x, y, color: userColor, byMachine: false });

    if (solveResult.status === 'solved') return 'solved';

    // continue：机器按正解分支回应一手
    const opp = solveResult.opponentMove!;
    const oppResult = game.placeStone(opp.x, opp.y);
    if (oppResult.success) {
      this.moves.push({ x: opp.x, y: opp.y, color: opp.color, byMachine: true });
    }
    return solveResult.doneAfterReply ? 'solved' : 'placed';
  }
}
