/**
 * 棋盘控制器
 * @module presentation/core/controllers/BoardController
 */
import type { IBoard } from '../interfaces/IBoard';
import type { IGame } from '../../../domain/game';
import type { Position, PlayerColor } from '../types';
/**
 * 棋盘控制器
 * 负责棋盘 UI 与游戏逻辑的绑定
 */
export class BoardController {
  private board: IBoard;
  private game: IGame;
  private unsubscribers: Array<() => void> = [];
  constructor(board: IBoard, game: IGame) {
    this.board = board;
    this.game = game;
  }
  /**
   * 绑定事件
   */
  bindEvents(): void {
    this.board.on({
      onClick: (pos: Position) => {
        const result = this.game.placeStone(pos.x, pos.y);
        if (result.success) {
          this.updateBoard();
        }
      },
    });
  }
  /**
   * 更新棋盘显示
   */
  updateBoard(): void {
    const state = this.game.getState();
    const board = this.game.getBoard();
    const size = board.size;
    // 收集所有棋子
    const stones: Array<{ pos: Position; color: PlayerColor | null }> = [];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const point = board.getPoint(x, y);
        if (point && point) {
          stones.push({
            pos: { x, y },
            color: point as PlayerColor,
          });
        }
      }
    }
    // 批量更新棋盘
    this.board.setStones(stones);
    // 高亮最后一手
    if (state.lastMove) {
      this.board.clearHighlight();
      this.board.highlight(state.lastMove, 'last');
    }
  }
  /**
   * 悔棋
   */
  undo(): void {
    const success = this.game.undo();
    if (success) {
      this.updateBoard();
    }
  }
  /**
   * 新游戏
   */
  newGame(): void {
    this.game.newGame();
    this.board.clear();
    this.board.render();
  }
  /**
   * 停一手
   */
  pass(): void {
    this.game.pass();
    this.updateBoard();
  }
  /**
   * 认输
   */
  resign(): void {
    // 游戏结束逻辑
    this.board.clear();
    this.board.render();
  }
  /**
   * 销毁
   */
  destroy(): void {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
    this.board.destroy();
  }
}
