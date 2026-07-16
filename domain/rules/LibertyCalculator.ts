import type { ICoordinate } from '../coordinate';
import type { PlayerColor } from '../primitives';
import type { IBoard } from '../board';
import type { ILibertyCalculator, IStoneGroup } from './ILibertyCalculator';
import { createCoordinate, getCoordinateKey } from '../coordinate';

/**
 * 气计算器实现
 * 使用 BFS 算法查找连通块和计算气数
 * @ai-example
 * const calc = new LibertyCalculator();
 * const board = new Board(19);
 * board.setStone(3, 3, 'black');
 * calc.countLiberties(board, 3, 3); // 4
 */
export class LibertyCalculator implements ILibertyCalculator {
  /**
   * 计算指定位置的棋子群的气数
   */
  countLiberties(board: IBoard, x: number, y: number): number {
    return this.getLiberties(board, x, y).length;
  }

  /**
   * 获取指定位置的棋子群的所有气位
   */
  getLiberties(board: IBoard, x: number, y: number): ICoordinate[] {
    const group = this.findGroup(board, x, y);
    if (group.stones.length === 0) return [];
    const liberties = new Set<string>();
    const libertiesList: ICoordinate[] = [];
    for (const stone of group.stones) {
      const adjacent = this.getAdjacentPositions(board, stone.x, stone.y);
      for (const pos of adjacent) {
        const key = getCoordinateKey(pos);
        if (!liberties.has(key) && board.getStone(pos.x, pos.y) === null) {
          liberties.add(key);
          libertiesList.push(pos);
        }
      }
    }
    return libertiesList;
  }

  /**
   * 查找连通块（使用 BFS）
   */
  findGroup(board: IBoard, x: number, y: number): IStoneGroup {
    const color = board.getStone(x, y);
    if (!color) {
      return { stones: [], color: 'black' };
    }
    const stones: ICoordinate[] = [];
    const visited = new Set<string>();
    const queue: ICoordinate[] = [createCoordinate(x, y)];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = getCoordinateKey(current);
      if (visited.has(key)) continue;
      visited.add(key);
      const stoneColor = board.getStone(current.x, current.y);
      if (stoneColor === color) {
        stones.push(current);
        const adjacent = this.getAdjacentPositions(board, current.x, current.y);
        for (const pos of adjacent) {
          const posKey = getCoordinateKey(pos);
          if (!visited.has(posKey)) {
            queue.push(pos);
          }
        }
      }
    }
    return { stones, color };
  }

  /**
   * 获取相邻位置（上下左右）
   */
  private getAdjacentPositions(
    board: IBoard,
    x: number,
    y: number
  ): ICoordinate[] {
    const directions = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ];
    const result: ICoordinate[] = [];
    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (board.isValidPosition(nx, ny)) {
        result.push(createCoordinate(nx, ny));
      }
    }
    return result;
  }
}