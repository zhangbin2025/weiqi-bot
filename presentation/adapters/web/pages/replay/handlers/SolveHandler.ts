/**
 * ReplayPage 死活题做题处理器
 * @description 做题模式下：点击交叉点直接检测是否进入正确路径，
 *              命中则机器自动回应一手，走完任一正确分支即成功，
 *              未命中即失败并重置棋局。与试下模式（TrialHandler）完全独立。
 */
import type { TrialController, TrialMove } from '../../../../../core/controllers';
import type { ReplayPageState } from '../state/ReplayPageState';
import type { ReplayPageUI } from '../ui/ReplayPageUI';
import type { ReplayApp } from '../../../../../../application/replay';
import type { Game } from '../../../../../../domain/game';
import type { ReplayData } from '../../../../../../domain/sgf';
import { BoardRebuilder } from '../../../../../core/helpers/BoardRebuilder';
import { BoardSyncer } from '../../../../../core/helpers/BoardSyncer';
import { TsumegoChecker } from '../../../../../core/helpers/TsumegoChecker';

interface ToastLink { text: string; onClick: () => void; }
type ToastType = 'success' | 'error' | 'info';

export class SolveHandler {
  constructor(
    private state: ReplayPageState,
    private ui: ReplayPageUI,
    private replayApp: ReplayApp,
    private game: Game,
    private board: any,
    private boardRebuilderClass: typeof BoardRebuilder,
    private boardSyncerClass: typeof BoardSyncer,
    private tsumegoChecker: TsumegoChecker,
    private showToast: (msg: string, type?: ToastType, links?: ToastLink[], persist?: boolean) => void,
    private onStudy: () => void,
    private onRestart: () => void
  ) {}

  /**
   * 进入做题模式：显示初始棋局（move=0），隐藏变化图面板
   */
  enterSolve(): void {
    this.state.set('mode', 'solve');
    this.state.set('solveDone', false);
    this.tsumegoChecker.resetSolve();
    this.ui.setSolveModeUI(true);
    // 重建并停留在初始局面
    this.rebuildBoard([], 0);
    this.syncBoardToDisplay();
  }

  /**
   * 退出做题模式（切回常规打谱）
   */
  exitSolve(): void {
    this.state.set('mode', 'review');
    this.state.set('solveDone', false);
    this.state.set('solveFailed', false);
    this.tsumegoChecker.resetSolve();
    this.ui.setSolveModeUI(false);
  }

  /**
   * 处理棋盘点击（仅做题模式调用）
   */
  handleBoardClick(x: number, y: number): void {
    if (this.state.get('solveDone') || this.state.get('solveFailed')) {
      // 已完成 / 已答错待处理：不再接受落子，等待用户点击「重做」或「研究」
      return;
    }
    // 已有棋子 / 非法点：不处理（按需求非法着法视为 bug，不提示）
    if (this.game.getState().board.getStone(x, y) !== null) return;

    const state = this.game.getState();
    const currentPlayer = state.currentPlayer;
    const result = this.game.placeStone(x, y);
    if (!result.success) return;

    // 播放落子音效
    if (this.state.get('soundEnabled')) {
      this.replayApp.playSound('stone');
    }

    // 调用做题判定
    const solveResult = this.tsumegoChecker.solveMove({
      x, y,
      color: currentPlayer === 'black' ? 'B' : 'W',
    });

    if (solveResult.status === 'wrong') {
      // 先不重置棋谱：提示错误并给出「重做/研究」链接，用户点击「重做」才重置
      this.state.set('solveFailed', true);
      this.showToast('答错了，再试一次', 'error', [
        { text: '重做', onClick: () => this.restart() },
        { text: '研究', onClick: () => this.onStudy() },
      ], true);
      return;
    }

    if (solveResult.status === 'solved') {
      this.state.set('solveDone', true);
      this.syncBoardToDisplay();
      this.showToast('正解完成 🎉', 'success', [
        { text: '研究', onClick: () => this.onStudy() },
      ], true);
      return;
    }

    // continue：机器（应对方）自动回应一手
    const opp = solveResult.opponentMove!;
    const oppResult = this.game.placeStone(opp.x, opp.y);
    if (oppResult.success && this.state.get('soundEnabled')) {
      this.replayApp.playSound('stone');
    }
    this.syncBoardToDisplay();

    // 该应手为正解收尾着法：落完即正解完成
    if (solveResult.doneAfterReply) {
      this.state.set('solveDone', true);
      this.showToast('正解完成 🎉', 'success', [
        { text: '研究', onClick: () => this.onStudy() },
      ], true);
    }
  }

  /**
   * 重新开始答题（失败后的重做，或外部触发）
   */
  restart(): void {
    this.state.set('solveDone', false);
    this.state.set('solveFailed', false);
    this.resetToInitial();
  }

  /**
   * 重置到初始棋局（move=0）
   */
  private resetToInitial(): void {
    this.tsumegoChecker.resetSolve();
    this.state.set('solveDone', false);
    this.state.set('solveFailed', false);
    this.rebuildBoard([], 0);
    this.syncBoardToDisplay();
  }

  /**
   * 重建棋盘状态（指定路径 + 手数）
   */
  private rebuildBoard(path: number[], targetIndex: number): void {
    const replayData = this.state.get('replayData');
    if (!replayData) return;
    const moveNumbersList = this.boardRebuilderClass.rebuild(
      this.game,
      replayData,
      path,
      targetIndex,
      {
        handicapStones: replayData.handicap_stones,
        initialPlayer: replayData.initial_player,
        inVariation: false,
      }
    );
    this.state.set('moveNumbersList', moveNumbersList);
  }

  /**
   * 同步棋盘显示
   */
  private syncBoardToDisplay(): void {
    const showMoveNumbers = this.state.get('showMoveNumbers');
    const moveNumbersList = this.state.get('moveNumbersList');
    this.boardSyncerClass.sync(this.board, this.game, moveNumbersList, showMoveNumbers);
  }
}
