/**
 * @fileoverview AI 自对弈状态管理
 * @description 管理 BoardState、历史记录、落子逻辑
 */

import { Game } from '../../../domain/game';
import type { BoardState } from '../../../domain/board';
import type { PlayerColor, MoveRecord } from './types';

/**
 * 自对弈状态管理器
 * @ai-example
 * const manager = new MMStateManager();
 * manager.placeStone(3, 3, 'black');
 * manager.switchPlayer();
 */
export class MMStateManager {
  private game: Game;
  private komi: number = 7.5;

  constructor() {
    this.game = new Game();
  }

  /**
   * 获取棋盘状态
   */
  getBoard(): BoardState {
    return this.game.getBoard().getState() as BoardState;
  }

  /**
   * 获取当前玩家
   */
  getCurrentPlayer(): PlayerColor {
    return this.game.getState().currentPlayer;
  }

  /**
   * 获取贴目
   */
  getKomi(): number {
    return this.komi;
  }

  /**
   * 获取完整状态
   */
  getState() {
    const state = this.game.getState();
    return {
      board: this.getBoard(),
      currentPlayer: state.currentPlayer,
      currentMove: state.moveHistory.length,
      moveHistory: state.moveHistory.map((move, index) => ({
        x: 'x' in move ? move.x : -1,
        y: 'y' in move ? move.y : -1,
        color: move.color,
        moveNum: index + 1,
      })),
      gameEnded: state.phase === 'ended',
      capturedBlack: state.capturedBlack,
      capturedWhite: state.capturedWhite,
      blackScore: undefined,
      whiteScore: undefined,
      koPosition: state.koPosition,
    };
  }

  /**
   * 设置状态（用于草稿恢复）
   */
  setState(state: any): void {
    this.game.newGame({ size: 19, komi: this.komi });
    
    // 重放历史记录
    for (const move of state.moveHistory) {
      if (move.x === -1 && move.y === -1) {
        this.game.pass();
      } else {
        this.game.placeStone(move.x, move.y);
      }
    }
  }

  /**
   * 获取历史记录
   */
  getMoveHistory(): MoveRecord[] {
    const state = this.game.getState();
    return state.moveHistory.map((move, index) => ({
      x: 'x' in move ? move.x : -1,
      y: 'y' in move ? move.y : -1,
      color: move.color,
      moveNum: index + 1,
    }));
  }

  /**
   * 获取当前手数
   */
  getCurrentMove(): number {
    return this.game.getState().moveHistory.length;
  }

  /**
   * 检查对局是否结束
   */
  isGameEnded(): boolean {
    return this.game.getState().phase === 'ended';
  }

  /**
   * 获取得分
   */
  getScores(): { black: number | undefined; white: number | undefined } {
    const state = this.game.getState();
    return { 
      black: state.capturedBlack, 
      white: state.capturedWhite 
    };
  }

  /**
   * 落子（代理到 Game）
   */
  placeStone(x: number, y: number, color: PlayerColor): { captured: Array<{x: number; y: number}> } {
    // 处理 pass 的情况（x=-1, y=-1）
    if (x === -1 && y === -1) {
      this.game.pass();
      return { captured: [] };
    }
    
    // 调用 Game 的落子方法（包含提子、打劫等规则）
    const result = this.game.placeStone(x, y);
    
    if (result.success) {
      return { captured: [...result.captured] };
    }
    
    return { captured: [] };
  }

  /**
   * 停一手（pass）
   */
  pass(color: PlayerColor): void {
    this.game.pass();
  }

  /**
   * 切换玩家
   */
  switchPlayer(): void {
    // Game.placeStone 会自动切换玩家，这里不需要手动切换
  }

  /**
   * 结束对局
   */
  endGame(blackScore?: number, whiteScore?: number): void {
    // Game 通过连续 pass 自动结束，这里可以强制结束
    // TODO: 如果需要手动结束，可以在 Game 中添加 forceEnd 方法
  }

  /**
   * 查找空位（用于 AI 生成落子）
   */
  findEmptyPositions(): Array<{ x: number; y: number }> {
    const board = this.getBoard();
    const empty: Array<{ x: number; y: number }> = [];
    const size = board.length;
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (board[y]![x] === null) {
          empty.push({ x, y });
        }
      }
    }
    return empty;
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.game.newGame({ size: 19, komi: this.komi });
  }
}