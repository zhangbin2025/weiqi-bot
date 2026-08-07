import type { PlayerColor } from '../primitives';
import type { IBoard } from '../board';
import type { ICoordinate } from '../coordinate';
import type { ICaptureRule, ICaptureResult } from './ICaptureRule';
import { LibertyCalculator } from './LibertyCalculator';
import { createCoordinate, getCoordinateKey } from '../coordinate';
import { getOpponentColor } from '../primitives';

/**
 * 提子规则实现
 * 判断落子后能否提取对方无气的棋子
 * @ai-example
 * const rule = new CaptureRule();
 * const board = new Board(19);
 * // 设置一个可以吃子的局面
 * board.setStone(0, 0, 'white');
 * board.setStone(1, 0, 'black');
 * board.setStone(0, 1, 'black');
 * rule.capture(board, 0, 0, 'black'); // 提掉 (0,0) 的白子
 */
export class CaptureRule implements ICaptureRule {
  private libertyCalc: LibertyCalculator;

  constructor() {
    this.libertyCalc = new LibertyCalculator();
  }

  /**
   * 执行提子判定
   * 检查落子后四个方向的对方棋子群是否被提
   */
  capture(board: IBoard, x: number, y: number, color: PlayerColor): ICaptureResult {
    const opponent = getOpponentColor(color);
    const captured: ICoordinate[] = [];
    const capturedKeys = new Set<string>();
    // 检查四个方向的对方棋子
    const directions = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ];
    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (!board.isValidPosition(nx, ny)) continue;
      const neighborColor = board.getStone(nx, ny);
      if (neighborColor !== opponent) continue;
      const key = getCoordinateKey(createCoordinate(nx, ny));
      if (capturedKeys.has(key)) continue;
      // 计算对方棋子群的气数
      const liberties = this.libertyCalc.countLiberties(board, nx, ny);
      if (liberties === 0) {
        // 没有气，提子
        const group = this.libertyCalc.findGroup(board, nx, ny);
        for (const stone of group.stones) {
          const stoneKey = getCoordinateKey(stone);
          if (!capturedKeys.has(stoneKey)) {
            capturedKeys.add(stoneKey);
            captured.push(stone);
          }
        }
      }
    }
    return { captured, count: captured.length };
  }
}