/**
 * 复盘页面交互逻辑 — 变化图引导、试下、状态栈管理
 * @module presentation/adapters/web/pages/review/ReviewInteraction
 *
 * 状态栈规则（用户需求）：
 * - 每进入一个新的状态类型，入栈当前状态
 * - 在同一状态内继续操作（路径点击、试下着法），不入栈
 * - 退出时弹出栈顶，恢复到上一层状态
 *
 * 入栈链示例：
 * 1. 棋谱→AI推荐→选点(入栈)→点击选点→路径(入栈)→沿路径点(不入栈)→退出→退出→棋谱
 * 2. 棋谱→点击交叉点→试下(入栈)→试下着法(不入栈)→AI推荐→选点(入栈)→点击选点→路径(入栈)
 *    →沿路径点(不入栈)→点击其它交叉点→试下(入栈)→退出→退出→退出→棋谱
 */
import type { WebBoard } from '../../components/Board';
import { Game } from '../../../../../domain/game';
import { BoardSyncer } from '../../../../core/helpers/BoardSyncer';
import { VariationManager, type VariationLayer } from './VariationManager';
import type { RecommendationCircle } from '../../components/BoardRenderer';
import type { PlayerColor } from '../../../../../domain/primitives';

/** 页面模式 */
export type PageMode = 'normal' | 'recommendation' | 'variation' | 'trial';

/**
 * 状态快照 — 入栈时保存的完整状态（足以恢复一切）
 *
 * 关键数据说明：
 * - moves: 棋盘上应该显示的完整着法（base部分 + trial部分）
 * - trialMoveStart: base和trial的分界点，moves[0..trialMoveStart-1]是base，之后是trial
 * - startMovesCount: 当前层"第一步不能撤销"的边界值
 *   例如进入variation后下了第一步，startMovesCount=第一步后的着法数
 */
export interface VariationState {
  mode: PageMode;
  /** 完整着法列表（base + trial） */
  moves: Array<{ x: number; y: number; color: PlayerColor }>;
  /** baseMoves 的长度 — trialMoves 从这个位置开始 */
  trialMoveStart: number;
  /** 推荐圆圈 */
  recommendationCircles: RecommendationCircle[];
  /** PV 序列和索引 */
  currentVariationPv: string[];
  variationPvIndex: number;
  /** 撤销边界 — 当前状态下不能撤销到少于此值 */
  startMovesCount: number;
}

/** 交互回调 */
export interface InteractionCallbacks {
  onModeChange: (mode: PageMode) => void;
  onStatusUpdate: (msg: string) => void;
  onDepthChange: (depth: number) => void;
  onLayerChange: (layer: VariationLayer) => void;
  onUndoStateChanged: () => void;
  onStonePlaced: () => void;
  getCurrentMove: () => number;
  onActualMoveClick?: () => void; // 点击实战落点的回调
}

export class ReviewInteraction {
  private board: WebBoard;
  private game: Game;
  private variationManager: VariationManager | null = null;
  private callbacks: InteractionCallbacks;

  private mode: PageMode = 'normal';
  private stateStack: VariationState[] = [];
  readonly MAX_DEPTH = 10;

  /** PV 引导状态 */
  private currentVariationPv: string[] = [];
  private variationPvIndex = 0;

  /** 当前显示的推荐圆圈 */
  private currentRecommendationCircles: RecommendationCircle[] = [];

  /** 基础着法（完整棋谱） */
  private baseMoves: Array<{ x: number; y: number; color: PlayerColor }> = [];
  
  /** 让子棋 */
  private handicapStones: Array<{ x: number; y: number; color: PlayerColor }> = [];

  constructor(board: WebBoard, game: Game, callbacks: InteractionCallbacks) {
    this.board = board;
    this.game = this.game = game;
    this.callbacks = callbacks;
  }

  // ========== 初始化 ==========

  initVariationManager(): void {
    this.variationManager = new VariationManager({
      board: this.board,
      game: this.game,
      onLayerChange: (layer) => this.callbacks.onLayerChange(layer),
    });
  }

  initializeBaseLayer(moves: Array<{ x: number; y: number; color: PlayerColor }>, handicapStones?: Array<{ x: number; y: number; color: PlayerColor }>): void {
    this.baseMoves = moves;
    this.handicapStones = handicapStones ?? [];
    this.variationManager?.initializeBaseLayer(moves);
  }

  // ========== 状态查询 ==========

  getMode(): PageMode { return this.mode; }
  getDepth(): number { return this.stateStack.length; }
  isMaxDepth(): boolean { return this.stateStack.length >= this.MAX_DEPTH; }
  isInTrial(): boolean { return this.variationManager?.isInTrial() ?? false; }
  getCurrentMoves(): Array<{ x: number; y: number; color: PlayerColor }> {
    return this.variationManager?.getCurrentMoves() ?? [];
  }

  isUndoDisabled(): boolean {
    if (!this.variationManager?.isInTrial()) return true;
    const currentMoves = this.variationManager.getCurrentMoves();
    const startMovesCount = this.stateStack.length > 0
      ? this.stateStack[this.stateStack.length - 1]!.startMovesCount
      : this.baseMoves.length;
    return currentMoves.length <= startMovesCount;
  }

  // ========== 核心操作 ==========

  /** 进入推荐模式（AI推荐按钮 → ReviewPage.analyzeCurrentPosition 调用）*/
  enterRecommendation(circles: RecommendationCircle[]): void {
    this.pushCurrentState();
    this.currentRecommendationCircles = [...circles];
    this.board.setRecommendationCircles(circles);
    this.mode = 'recommendation';
    this.fireModeChanged();
  }

  /** 处理棋盘点击 */
  handleBoardClick(x: number, y: number): void {
    if (this.stateStack.length >= this.MAX_DEPTH) return;
    // 已有棋子的位置不能点击
    if (this.game.getBoard().getStone(x, y) !== null) return;
    const clickedCircle = this.board.getClickedRecommendation(x, y);

    switch (this.mode) {
      case 'recommendation':
        if (clickedCircle) {
          // 如果点击的是实战落点圆圈，调用回调
          if (clickedCircle.isActualMove) {
            this.callbacks.onActualMoveClick?.();
          } else {
            this.startVariationGuide(clickedCircle);
          }
        } else {
          this.enterTrial(x, y);
        }
        break;
      case 'variation':
        if (clickedCircle) {
          this.continueVariation(clickedCircle);
        } else {
          this.enterTrial(x, y);
        }
        break;
      case 'trial':
        this.addTrialMove(x, y);
        break;
      case 'normal':
        this.enterTrial(x, y);
        break;
    }
  }

  /** 撤销一步 — 不超过当前层的第一步 */
  undo(): void {
    if (!this.variationManager?.isInTrial()) return;
    const currentMoves = this.variationManager.getCurrentMoves();
    const startMovesCount = this.stateStack.length > 0
      ? this.stateStack[this.stateStack.length - 1]!.startMovesCount
      : this.baseMoves.length;
    if (currentMoves.length <= startMovesCount) return;

    this.variationManager.undo();
    this.rebuildBoardFromCurrentMoves();

    if (this.mode === 'variation' && this.variationPvIndex > 0) {
      this.variationPvIndex--;
      this.showNextPvStep();
    }
    this.callbacks.onUndoStateChanged();
  }

  /** 退出当前状态 — 弹出栈顶，恢复上一层 */
  exit(): void {
    const prev = this.stateStack.pop();
    if (!prev) {
      this.returnToNormal();
      return;
    }
    // 1. 恢复 VariationManager
    this.restoreVariationManager(prev);
    // 2. 用保存的 moves 直接重建棋盘（不从 VM 读，因为 VM 恢复后可能不准）
    this.restoreBoardFromMoves(prev.moves);
    // 3. 恢复 PV 状态
    this.currentVariationPv = prev.currentVariationPv;
    this.variationPvIndex = prev.variationPvIndex;
    // 4. 恢复圆圈
    this.restoreCircles(prev);
    // 5. 恢复模式
    this.mode = prev.mode;
    this.fireModeChanged();
  }

  /** 销毁 */
  destroy(): void {
    this.variationManager?.destroy();
  }

  // ========== 内部方法 ==========

  /**
   * 获取当前棋盘实际显示的着法
   * - 在 trial/variation 模式下：从 VM 读取（base+trial）
   * - 在 normal/recommendation 模式下：棋谱到 currentMove 的着法
   */
  private getDisplayedMoves(): Array<{ x: number; y: number; color: PlayerColor }> {
    if (this.variationManager?.isInTrial()) {
      return this.variationManager.getCurrentMoves();
    }
    // normal/recommendation: 棋谱到当前手
    const currentMove = this.callbacks.getCurrentMove();
    return this.baseMoves.slice(0, currentMove);
  }

  /** 将当前视觉状态推入栈 */
  private pushCurrentState(): void {
    const currentMoves = this.getDisplayedMoves();
    const isInTrialNow = this.variationManager?.isInTrial() ?? false;
    // trialMoveStart: 在 trial 中取 VM 层的 baseMoves 长度；否则全都是 base
    const trialMoveStart = isInTrialNow
      ? (this.variationManager!.getCurrentLayer()!.baseMoves.length)
      : currentMoves.length;

    this.stateStack.push({
      mode: this.mode,
      moves: currentMoves,
      trialMoveStart,
      recommendationCircles: [...this.currentRecommendationCircles],
      currentVariationPv: [...this.currentVariationPv],
      variationPvIndex: this.variationPvIndex,
      startMovesCount: currentMoves.length,
    });
    this.callbacks.onDepthChange(this.stateStack.length);
    this.callbacks.onUndoStateChanged();
  }

  /**
   * 恢复 VariationManager 到指定状态
   * 关键：用 trialMoveStart < moves.length 判断是否有 trial 着法，
   * 而不是用 mode 判断（recommendation 模式也可能有 trial 着法）
   */
  private restoreVariationManager(state: VariationState): void {
    if (!this.variationManager) return;

    const hasTrialMoves = state.trialMoveStart < state.moves.length;
    const baseMoves = state.moves.slice(0, state.trialMoveStart);
    const trialMoves = state.moves.slice(state.trialMoveStart);

    // 先退出当前 trial
    if (this.variationManager.isInTrial()) {
      this.variationManager.exitTrial();
    }

    if (hasTrialMoves) {
      // 有 trial 着法 → 重建 trial 层
      const currentMove = baseMoves.length;
      this.variationManager.enterTrial(currentMove, baseMoves);
      for (const move of trialMoves) {
        this.variationManager.addTrialMove(move.x, move.y, move.color);
      }
    }
    // 没有 trial 着法 → 停在 base layer
  }

  /** 用保存的着法直接重建棋盘显示 */
  private restoreBoardFromMoves(moves: Array<{ x: number; y: number; color: PlayerColor }>): void {
    this.game.newGame({ size: 19 });
    
    // 设置让子棋（使用Game.setHandicapStones方法）
    if (this.handicapStones.length > 0) {
      const handicapStones = this.handicapStones.map(stone => ({
        x: stone.x,
        y: stone.y,
        color: stone.color === 'black' ? 'B' as const : 'W' as const
      }));
      this.game.setHandicapStones(handicapStones);
    }
    
    // 然后放置着法
    for (const move of moves) {
      this.game.placeStone(move.x, move.y);
    }
    BoardSyncer.sync(this.board, this.game, [], false);
  }

  /** 恢复圆圈 */
  private restoreCircles(state: VariationState): void {
    if (state.mode === 'variation') {
      this.currentRecommendationCircles = [];
      this.showNextPvStep();
    } else if (state.recommendationCircles.length > 0) {
      this.currentRecommendationCircles = [...state.recommendationCircles];
      this.board.setRecommendationCircles(state.recommendationCircles);
    } else {
      this.currentRecommendationCircles = [];
      this.board.clearRecommendationCircles();
    }
  }

  /** 从 normal/recommendation 进入试下 */
  private enterTrial(x: number, y: number): void {
    this.pushCurrentState();
    if (!this.variationManager?.isInTrial()) {
      const currentMove = this.callbacks.getCurrentMove();
      this.variationManager?.enterTrial(currentMove, this.baseMoves);
    }
    this.doAddTrialMove(x, y);
    // 第一步试下不能撤销 — 更新栈顶的 startMovesCount
    this.updateStackStartMovesCount();
    this.currentRecommendationCircles = [];
    this.board.clearRecommendationCircles();
    this.currentVariationPv = [];
    this.variationPvIndex = 0;
    this.mode = 'trial';
    this.fireModeChanged();
  }

  /** 进入路径引导 */
  private startVariationGuide(circle: RecommendationCircle): void {
    this.pushCurrentState();
    this.currentRecommendationCircles = [];
    this.board.clearRecommendationCircles();
    this.currentVariationPv = (circle.pv ?? []).slice(1);
    this.variationPvIndex = 0;
    if (!this.variationManager?.isInTrial()) {
      const currentMove = this.callbacks.getCurrentMove();
      this.variationManager?.enterTrial(currentMove, this.baseMoves);
    }
    this.doAddTrialMove(circle.x, circle.y);
    // 第一步是选点，不能撤销 — 更新栈顶的 startMovesCount
    this.updateStackStartMovesCount();
    this.mode = 'variation';
    this.fireModeChanged();
    this.showNextPvStep();
  }

  /** 继续路径引导 — 不入栈 */
  private continueVariation(circle: RecommendationCircle): void {
    this.doAddTrialMove(circle.x, circle.y);
    this.variationPvIndex++;
    this.showNextPvStep();
    this.callbacks.onUndoStateChanged();
  }

  /** 试下着法 — 不入栈 */
  private addTrialMove(x: number, y: number): void {
    this.doAddTrialMove(x, y);
    this.callbacks.onUndoStateChanged();
  }

  /** 实际添加试下着法到 variationManager */
  private doAddTrialMove(x: number, y: number): void {
    if (!this.variationManager?.isInTrial()) return;
    const currentMoves = this.variationManager.getCurrentMoves();
    const lastMove = currentMoves.length > 0 ? currentMoves[currentMoves.length - 1] : null;
    const currentPlayer: PlayerColor = lastMove?.color === 'black' ? 'white' : 'black';
    this.variationManager.addTrialMove(x, y, currentPlayer);
    this.rebuildBoardFromCurrentMoves();
    this.callbacks.onStonePlaced();
  }

  /** 从 variationManager 当前着法重建棋盘 */
  private rebuildBoardFromCurrentMoves(): void {
    const moves = this.variationManager?.getCurrentMoves() ?? [];
    this.restoreBoardFromMoves(moves);
  }

  /** 更新栈顶的 startMovesCount — 第一步着法后调用，使第一步不可撤销 */
  private updateStackStartMovesCount(): void {
    if (this.stateStack.length > 0) {
      this.stateStack[this.stateStack.length - 1]!.startMovesCount =
        this.variationManager?.getCurrentMoves().length ?? 0;
    }
  }

  /** 回到棋谱模式 */
  private returnToNormal(): void {
    this.mode = 'normal';
    this.currentRecommendationCircles = [];
    this.board.clearRecommendationCircles();
    this.currentVariationPv = [];
    this.variationPvIndex = 0;
    this.stateStack = [];
    if (this.variationManager?.isInTrial()) {
      this.variationManager.exitTrial();
    }
    this.fireModeChanged();
  }

  /** 触发模式变更回调 */
  private fireModeChanged(): void {
    this.callbacks.onModeChange(this.mode);
    this.callbacks.onDepthChange(this.stateStack.length);
    this.callbacks.onUndoStateChanged();
  }

  /** 显示下一步 PV 引导圆圈 */
  private showNextPvStep(): void {
    if (this.variationPvIndex >= this.currentVariationPv.length) {
      this.board.clearRecommendationCircles();
      return;
    }
    const nextPvCoord = this.currentVariationPv[this.variationPvIndex];
    if (!nextPvCoord || nextPvCoord.length < 2) {
      this.board.clearRecommendationCircles();
      return;
    }
    const letterUpper = nextPvCoord.charAt(0).toUpperCase();
    const numberStr = nextPvCoord.substring(1);
    let pvX: number;
    if (letterUpper >= 'A' && letterUpper <= 'H') {
      pvX = letterUpper.charCodeAt(0) - 65;
    } else if (letterUpper >= 'J' && letterUpper <= 'T') {
      pvX = letterUpper.charCodeAt(0) - 66;
    } else {
      this.board.clearRecommendationCircles();
      return;
    }
    const pvY = 19 - parseInt(numberStr, 10);
    if (pvX >= 0 && pvX < 19 && pvY >= 0 && pvY < 19) {
      this.board.setRecommendationCircles([{
        x: pvX, y: pvY, rank: 1,
        pv: this.currentVariationPv.slice(this.variationPvIndex + 1),
      }]);
    } else {
      this.board.clearRecommendationCircles();
    }
  }
}
