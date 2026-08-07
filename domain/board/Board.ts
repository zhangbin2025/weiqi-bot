import type { PlayerColor } from '../primitives';
import type { IBoard, BoardState } from './IBoard';
import { createEmptyBoardState } from './IBoard';

/**
 * 棋盘实现
 * 管理棋盘状态和棋子位置
 * @ai-example
 * const board = new Board(19);
 * board.setStone(3, 3, 'black');
 * board.getStone(3, 3); // 'black'
 */
export class Board implements IBoard {
  readonly size: number;
  private state: BoardState;

  constructor(size: number = 19) {
    this.size = size;
    this.state = createEmptyBoardState(size);
  }

  /**
   * 获取指定位置的棋子颜色
   */
  getStone(x: number, y: number): PlayerColor | null {
    if (!this.isValidPosition(x, y)) return null;
    return this.state[y]?.[x] ?? null;
  }

  /**
   * 获取指定位置的棋子颜色（别名）
   */
  getPoint(x: number, y: number): PlayerColor | null {
    return this.getStone(x, y);
  }

  /**
   * 设置指定位置的棋子
   */
  setStone(x: number, y: number, color: PlayerColor | null): void {
    if (!this.isValidPosition(x, y)) return;
    this.state[y]![x] = color;
  }

  /**
   * 检查坐标是否有效
   */
  isValidPosition(x: number, y: number): boolean {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  /**
   * 克隆棋盘
   */
  clone(): Board {
    const newBoard = new Board(this.size);
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        newBoard.state[y]![x] = this.state[y]![x]!;
      }
    }
    return newBoard;
  }

  /**
   * 获取原始棋盘状态（只读）
   */
  getState(): Readonly<BoardState> {
    return this.state;
  }

  /**
   * 从棋盘状态恢复
   */
  static fromState(state: BoardState): Board {
    const size = state.length;
    const board = new Board(size);
    board.state = state.map((row) => [...row]);
    return board;
  }

  /**
   * 清空棋盘
   */
  clear(): void {
    this.state = createEmptyBoardState(this.size);
  }

  /**
   * 获取所有棋子位置
   */
  getAllStones(): { x: number; y: number; color: PlayerColor }[] {
    const stones: { x: number; y: number; color: PlayerColor }[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const color = this.state[y]![x];
        if (color) {
          stones.push({ x, y, color });
        }
      }
    }
    return stones;
  }

  /**
   * 统计棋子数量
   */
  countStones(): { black: number; white: number } {
    let black = 0;
    let white = 0;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const color = this.state[y]![x];
        if (color === 'black') black++;
        else if (color === 'white') white++;
      }
    }
    return { black, white };
  }
}