/**
 * 变化图浏览器组件
 * @description 显示和浏览变化图的每一步
 * @module presentation/adapters/web/pages/decision/VariationViewer
 */
import { BoardRebuilder, type MoveNumber } from '../../../../core/helpers/BoardRebuilder';
import { BoardSyncer } from '../../../../core/helpers/BoardSyncer';
import { coordToPos } from '../../../../../domain/sgf';
import { playerColorToSGFColor } from '../../../../../domain/primitives';
import type { WebBoard } from '../../components/Board';
import type { Game } from '../../../../../domain/game';
/** 变化图步骤 */
export interface VariationMove {
  color: 'B' | 'W';
  coord: string;
}
/** 变化图浏览器配置 */
export interface VariationViewerConfig {
  /** 棋盘组件 */
  board: WebBoard;
  /** 棋局模型 */
  game: Game;
  /** 容器元素 */
  container: HTMLElement;
  /** 关闭回调 */
  onClose: () => void;
}
/**
 * 变化图浏览器组件
 */
export class VariationViewer {
  private board: WebBoard;
  private game: Game;
  private container: HTMLElement;
  private onClose: () => void;
  private moves: VariationMove[] = [];
  private currentIndex = 0;
  private baseState: {
    stones: Array<{ x: number; y: number; color: 'B' | 'W' }>;
    moveNumbers: MoveNumber[];
  } | null = null;
  constructor(config: VariationViewerConfig) {
    this.board = config.board;
    this.game = config.game;
    this.container = config.container;
    this.onClose = config.onClose;
  }
  /**
   * 显示变化图
   */
  show(moves: VariationMove[], baseMoveNumbers: MoveNumber[]): void {
    this.moves = moves;
    this.currentIndex = 0;
    // 保存当前棋盘状态作为基准
    const state = this.game.getState();
    const gameBoard = this.game.getBoard();
    const stones: Array<{ x: number; y: number; color: 'B' | 'W' }> = [];
    for (let x = 0; x < gameBoard.size; x++) {
      for (let y = 0; y < gameBoard.size; y++) {
        const stone = gameBoard.getStone(x, y);
        if (stone) {
          stones.push({ x, y, color: playerColorToSGFColor(stone) });
        }
      }
    }
    this.baseState = {
      stones,
      moveNumbers: baseMoveNumbers,
    };
    this.render();
  }
  /**
   * 渲染变化图浏览器
   */
  private render(): void {
    this.container.innerHTML = `
      <div class="variation-viewer">
        <div class="variation-header">
          <span class="variation-title">变化图</span>
          <button class="btn-close" id="variationCloseBtn">✕</button>
        </div>
        <div class="variation-progress">
          第 ${this.currentIndex + 1} / ${this.moves.length} 手
        </div>
        <div class="variation-controls">
          <button class="btn btn-nav" id="varPrevBtn" ${this.currentIndex === 0 ? 'disabled' : ''}>◀</button>
          <button class="btn btn-nav" id="varNextBtn" ${this.currentIndex >= this.moves.length ? 'disabled' : ''}>▶</button>
        </div>
      </div>
    `;
    this.bindEvents();
    this.updateBoard();
  }
  /**
   * 绑定事件
   */
  private bindEvents(): void {
    const closeBtn = this.container.querySelector('#variationCloseBtn');
    const prevBtn = this.container.querySelector('#varPrevBtn');
    const nextBtn = this.container.querySelector('#varNextBtn');
    closeBtn?.addEventListener('click', () => {
      this.close();
    });
    prevBtn?.addEventListener('click', () => {
      this.prev();
    });
    nextBtn?.addEventListener('click', () => {
      this.next();
    });
  }
  /**
   * 更新棋盘显示
   */
  private updateBoard(): void {
    if (!this.baseState) return;
    // 重置棋盘到基准状态
    this.game.newGame({ size: 19 });
    // 放置基准棋子
    for (const stone of this.baseState.stones) {
      this.game.placeStone(stone.x, stone.y);
    }
    // 播放到当前步骤
    const moveNumbers: MoveNumber[] = [...this.baseState.moveNumbers];
    for (let i = 0; i < this.currentIndex; i++) {
      const move = this.moves[i];
      if (move) {
        const pos = coordToPos(move.coord);
        if (pos) {
          this.game.placeStone(pos.x, pos.y);
          moveNumbers.push({
            x: pos.x,
            y: pos.y,
            number: this.baseState.moveNumbers.length + i + 1,
          });
        }
      }
    }
    // 同步显示
    BoardSyncer.sync(this.board, this.game, moveNumbers, true);
  }
  /**
   * 上一步
   */
  private prev(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.render();
    }
  }
  /**
   * 下一步
   */
  private next(): void {
    if (this.currentIndex < this.moves.length) {
      this.currentIndex++;
      this.render();
    }
  }
  /**
   * 关闭变化图浏览器
   */
  private close(): void {
    this.container.innerHTML = '';
    this.onClose();
  }
  /**
   * 销毁组件
   */
  destroy(): void {
    this.container.innerHTML = '';
    this.moves = [];
    this.currentIndex = 0;
    this.baseState = null;
  }
}
