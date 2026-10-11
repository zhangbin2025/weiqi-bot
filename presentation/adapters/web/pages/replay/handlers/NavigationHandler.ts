/**
 * ReplayPage 导航处理器
 * @description 处理移动导航相关的逻辑
 */
import type { MoveNavigator } from '../../../../../core/controllers';
import type { ReplayPageState } from '../state/ReplayPageState';
import type { ReplayPageUI } from '../ui/ReplayPageUI';
import type { ReplayApp } from '../../../../../../application/replay';
import type { Game } from '../../../../../../domain/game';
import { coordToPos } from '../../../../../../domain/sgf';
import { BoardRebuilder, type MoveNumber } from '../../../../../core/helpers/BoardRebuilder';
import { BoardSyncer } from '../../../../../core/helpers/BoardSyncer';
export class NavigationHandler {
  /** 停一手（脱先）回调：浏览到 pass 着法时通知外部弹出提示 */
  private onPassMove?: ((moveNumber: number, color: 'black' | 'white') => void) | undefined;
  /** 上一次已提示过的停一手位置，避免同一步反复弹提示 */
  private lastPassKey: string | null = null;
  constructor(
    private state: ReplayPageState,
    private ui: ReplayPageUI,
    private moveNavigator: MoveNavigator,
    private replayApp: ReplayApp,
    private game: Game,
    private board: any,
    private boardRebuilderClass: typeof BoardRebuilder,
    private boardSyncerClass: typeof BoardSyncer
  ) {}
  /**
   * 设置「停一手（脱先）」回调
   */
  setOnPassMove(callback: (moveNumber: number, color: 'black' | 'white') => void): void {
    this.onPassMove = callback;
  }
  /**
   * 上一步
   */
  prevMove(): void {
    const inVariation = this.state.get('inVariation');
    const variationStartMove = this.state.get('variationStartMove');
    // 在分支模式下，使用本地导航
    if (inVariation) {
      const currentMove = this.state.getCurrentMoveNumber();
      if (currentMove <= variationStartMove) {
        return; // 已经在分支起点，不能再退
      }
      // 本地后退一步
      const displayIndex = this.state.get('displayIndex');
      if (displayIndex > 0) {
        this.state.set('displayIndex', displayIndex - 1);
      }
      this.updateDisplay();
      // 停一手提示
      this.notifyPassMove();
      // 播放音效
      if (this.state.get('soundEnabled')) {
        this.replayApp.playSound('stone');
      }
      return;
    }
    this.moveNavigator.prev();
    // 停一手提示
    this.notifyPassMove();
    // 播放音效
    if (this.state.get('soundEnabled')) {
      this.replayApp.playSound('stone');
    }
  }
  /**
   * 下一步
   */
  nextMove(): void {
    const inVariation = this.state.get('inVariation');
    // 在分支模式下，使用本地导航
    if (inVariation) {
      // 检查是否还有下一步
      const node = this.state.getCurrentNode();
      if (node?.children && node.children.length > 0) {
        const displayIndex = this.state.get('displayIndex');
        this.state.set('displayIndex', displayIndex + 1);
        this.updateDisplay();
        // 停一手提示
        this.notifyPassMove();
        // 播放音效
        if (this.state.get('soundEnabled')) {
          const nextNode = this.state.getCurrentNode();
          if (nextNode?.coord && this.isPassMove(nextNode.coord)) {
            this.replayApp.playSound('pass');
          } else if (this.hadCapture()) {
            this.replayApp.playSound('capture');
          } else {
            this.replayApp.playSound('stone');
          }
        }
      }
      return;
    }
    this.moveNavigator.next();
    // 停一手提示
    this.notifyPassMove();
    // 播放音效
    if (this.state.get('soundEnabled')) {
      this.replayApp.playSound('stone');
    }
  }
  /**
   * 跳转到指定手数（不播放音效，避免滑条拖动时大量触发）
   */
  goToMove(moveNum: number): void {
    this.moveNavigator.goTo(moveNum);
  }
  /**
   * 切换播放状态
   */
  togglePlay(): void {
    // 在开始播放前，尝试初始化 AudioContext（需要在用户手势中）
    if (this.state.get('soundEnabled')) {
      this.replayApp.initializeAudio();
    }
    this.moveNavigator.togglePlay();
  }
  /**
   * 更新显示
   */
  updateDisplay(): void {
    const replayData = this.state.get('replayData');
    if (!replayData) return;
    const currentPath = this.state.get('currentPath');
    const displayIndex = this.state.get('displayIndex');
    this.rebuildBoard(currentPath, displayIndex);
    this.syncBoardToDisplay();
    this.ui.updateStatusDisplay();
    this.ui.updateSubtitle();
    // 注意：updateVariationPanel 需要回调，由外部调用
  }
  /**
   * 若当前着法是「停一手（脱先）」，则触发一次提示
   * @description 供前进/后退/拖动滑条/自动播放等所有导航入口调用；
   *              同一位置只提示一次，离开该位置后会重新提示
   */
  notifyPassMove(): void {
    const pass = this.detectCurrentPass();
    if (!pass) {
      // 当前不是停一手，清除去重标记
      this.lastPassKey = null;
      return;
    }
    if (this.lastPassKey === pass.key) return;
    this.lastPassKey = pass.key;
    this.onPassMove?.(pass.moveNumber, pass.color);
  }
  /**
   * 检测当前着法是否为停一手（脱先）
   */
  private detectCurrentPass(): { key: string; moveNumber: number; color: 'black' | 'white' } | null {
    const replayData = this.state.get('replayData');
    if (!replayData) return null;
    const node = this.state.getCurrentNode();
    if (!node || !node.color) return null;
    // 有坐标且在棋盘内 => 正常落子
    const size = replayData.board_size;
    const pos = node.coord ? coordToPos(node.coord) : null;
    if (pos && pos.x >= 0 && pos.x < size && pos.y >= 0 && pos.y < size) {
      return null;
    }
    const key = `${this.state.get('currentPath').join('.')}|${this.state.get('displayIndex')}`;
    return {
      key,
      moveNumber: this.state.getCurrentMoveNumber(),
      color: node.color === 'B' ? 'black' : 'white',
    };
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
          initialPlayer: replayData.initial_player,
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
