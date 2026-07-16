/**
 * ReplayPage 分支处理器
 * @description 处理分支相关的逻辑
 */
import type { VariationController } from '../../../../../core/controllers';
import type { ReplayPageState } from '../state/ReplayPageState';
import type { ReplayPageUI } from '../ui/ReplayPageUI';
import type { ReplayApp } from '../../../../../../application/replay';
import type { Game } from '../../../../../../domain/game';
import { BoardRebuilder } from '../../../../../core/helpers/BoardRebuilder';
import { BoardSyncer } from '../../../../../core/helpers/BoardSyncer';
export class VariationHandler {
  private onEnterVariation?: (index: number) => void;
  constructor(
    private state: ReplayPageState,
    private ui: ReplayPageUI,
    private variationController: VariationController,
    private replayApp: ReplayApp,
    private game: Game,
    private board: any,
    private boardRebuilderClass: typeof BoardRebuilder,
    private boardSyncerClass: typeof BoardSyncer
  ) {}
  /**
   * 设置进入分支的回调函数
   */
  setOnEnterVariation(callback: (index: number) => void): void {
    this.onEnterVariation = callback;
  }
  /**
   * 进入分支
   */
  enterVariation(index: number): void {
    const replayData = this.state.get('replayData');
    if (!replayData) return;
    // 保存进入分支前的状态
    const currentMove = this.state.getCurrentMoveNumber();
    this.state.enterVariationMode(currentMove);
    // 将当前 displayIndex 转换为路径（沿着主分支走 displayIndex 步）
    let currentPath = [...this.state.get('currentPath')];
    const displayIndex = this.state.get('displayIndex');
    for (let i = 0; i < displayIndex; i++) {
      currentPath.push(0);
    }
    // 选择变化分支
    currentPath.push(index);
    // 更新状态
    this.state.set('currentPath', currentPath);
    this.state.set('displayIndex', 0);
    // 先调用 updateVariationModeUI 设置 showMoveNumbers = true
    this.ui.updateVariationModeUI();
    // 然后再调用 updateDisplay 显示手数
    this.updateDisplay();
    // 最后调用 updateVariationPanel 隐藏变化图面板
    if (this.onEnterVariation) {
      this.ui.updateVariationPanel(this.onEnterVariation);
    }
    // 进入分支时播放音效
    if (this.state.get('soundEnabled')) {
      this.replayApp.playSound('stone');
    }
  }
  /**
   * 返回主分支
   */
  backToParent(): void {
    const currentPath = this.state.get('currentPath');
    if (currentPath.length === 0) return;
    // 恢复进入分支前的状态
    this.state.exitVariationMode();
    this.updateDisplay();
    this.ui.updateVariationModeUI();
    // 退出分支后重新显示变化图面板
    if (this.onEnterVariation) {
      this.ui.updateVariationPanel(this.onEnterVariation);
    }
  }
  /**
   * 更新显示
   */
  private updateDisplay(): void {
    const replayData = this.state.get('replayData');
    if (!replayData) return;
    const currentPath = this.state.get('currentPath');
    const displayIndex = this.state.get('displayIndex');
    this.rebuildBoard(currentPath, displayIndex);
    this.syncBoardToDisplay();
    this.ui.updateStatusDisplay();
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
  /**
   * 判断是否为停一手（pass）
   */
  private isPassMove(coord: string): boolean {
    if (!coord || coord === '' || coord === 'tt' || coord === 'TT') return true;
    if (coord.length >= 2) {
      const x = coord.charCodeAt(0) - 97;
      const y = coord.charCodeAt(1) - 97;
      if (x < 0 || x >= 19 || y < 0 || y >= 19) return true;
    }
    return false;
  }
  /**
   * 判断最近一步是否有提子
   */
  private hadCapture(): boolean {
    const state = this.game.getState();
    return state.capturedBlack > 0 || state.capturedWhite > 0;
  }
}
