/**
 * ReplayPage 试下处理器
 * @description 处理试下模式相关的逻辑
 */
import type { TrialController, TrialMove } from '../../../../../core/controllers';
import type { ReplayPageState } from '../state/ReplayPageState';
import type { ReplayPageUI } from '../ui/ReplayPageUI';
import type { ReplayApp } from '../../../../../../application/replay';
import type { Game } from '../../../../../../domain/game';
import { BoardRebuilder } from '../../../../../core/helpers/BoardRebuilder';
import { BoardSyncer } from '../../../../../core/helpers/BoardSyncer';
export class TrialHandler {
  constructor(
    private state: ReplayPageState,
    private ui: ReplayPageUI,
    private trialController: TrialController,
    private replayApp: ReplayApp,
    private game: Game,
    private board: any,
    private boardRebuilderClass: typeof BoardRebuilder,
    private boardSyncerClass: typeof BoardSyncer
  ) {}
  /**
   * 处理棋盘点击
   * 如果不在试下模式，点击交叉点进入试下模式
   */
  handleBoardClick(x: number, y: number): void {
    const replayData = this.state.get('replayData');
    if (!replayData) return;
    const inVariation = this.state.get('inVariation');
    // 分支模式下不能试下
    if (inVariation) {
      console.warn('在分支模式下不能试下');
      return;
    }
    // 如果不在试下模式，进入试下模式
    if (!this.trialController.isInTrial()) {
      const currentPath = this.state.get('currentPath');
      const displayIndex = this.state.get('displayIndex');
      this.trialController.enterTrial([...currentPath], displayIndex);
      this.ui.showTrialPanel(true);
      this.updateTrialModeUI();
      // 进入试下模式后，需要重建棋盘状态
      this.rebuildBoardWithTrial();
    }
    // 试下落子
    const state = this.game.getState();
    const currentPlayer = state.currentPlayer;
    const result = this.game.placeStone(x, y);
    if (result.success) {
      this.trialController.addMove({
        x,
        y,
        color: currentPlayer,
        capturedCount: result.captured.length,
        capturedPositions: result.captured.map(c => ({ x: c.x, y: c.y }))
      });
      // 播放音效
      if (this.state.get('soundEnabled')) {
        this.replayApp.playSound('stone');
      }
      this.syncBoardToDisplay();
    }
  }
  /**
   * 试下后退
   */
  trialPrev(): void {
    this.trialController.undo();
    this.rebuildBoardWithTrial();
  }
  /**
   * 试下前进
   */
  trialNext(): void {
    this.trialController.redo();
    this.rebuildBoardWithTrial();
  }
  /**
   * 退出试下模式
   */
  exitTrial(): void {
    this.trialController.exitTrial();
    this.ui.showTrialPanel(false);
    this.updateTrialModeUI();
    // 恢复棋盘状态
    this.rebuildBoard(
      this.state.get('currentPath'),
      this.state.get('displayIndex')
    );
    this.syncBoardToDisplay();
  }
  /**
   * 更新试下模式 UI
   */
  private updateTrialModeUI(): void {
    // UI 更新由 ui.showTrialPanel 处理
  }
  /**
   * 重建试下棋盘状态
   */
  private rebuildBoardWithTrial(): void {
    this.rebuildBoard(
      this.state.get('currentPath'),
      this.state.get('displayIndex')
    );
    // 应用试下步骤
    const trialMoves = this.trialController.getVisibleMoves();
    for (const move of trialMoves) {
      this.game.placeStone(move.x, move.y);
    }
    this.syncBoardToDisplay();
  }
  /**
   * 重建棋盘状态
   */
  private rebuildBoard(path: number[], targetIndex: number): void {
    const replayData = this.state.get('replayData');
    if (!replayData) return;
    // 使用公共组件重建棋盘状态
    const moveNumbersList = this.boardRebuilderClass.rebuild(
      this.game,
      replayData,
      path,
      targetIndex,
      {
        handicapStones: replayData.handicap_stones,
        inVariation: this.state.get('inVariation'),
        variationStartIndex: this.state.get('savedDisplayIndex'),
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
    // 使用公共组件同步棋盘显示
    this.boardSyncerClass.sync(this.board, this.game, moveNumbersList, showMoveNumbers);
  }
}
