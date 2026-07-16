/**
 * 缩略图服务
 * 组合调用 Domain 层，提供棋盘状态构建和着法解析能力
 * @module services/thumbnail/ThumbnailService
 */

import { Board } from '../../domain/board/Board';
import { CaptureRule } from '../../domain/rules/CaptureRule';
import type { ThumbnailMove } from './types';
import { ThumbnailMoveParser } from './ThumbnailMoveParser';

/** 缩略图服务 */
export class ThumbnailService {
  private captureRule = new CaptureRule();

  /**
   * 构建棋盘状态（组合 Domain 层）
   * @param moves - 着法数组
   * @returns 棋盘实例
   * @ai-example
   * const service = new ThumbnailService();
   * const board = service.buildBoardState([{x:3, y:3, color:'black'}]);
   */
  buildBoardState(moves: ThumbnailMove[]): Board {
    const board = new Board(19);
    for (const move of moves) {
      if (move.isPass) continue;
      if (!board.isValidPosition(move.x, move.y)) continue;

      board.setStone(move.x, move.y, move.color);

      // 调用 Domain 层的提子规则
      const result = this.captureRule.capture(board, move.x, move.y, move.color);
      for (const cap of result.captured) {
        board.setStone(cap.x, cap.y, null);
      }
    }
    return board;
  }

  /**
   * 解析着法数据
   * 支持 JSON、SGF、坐标字符串格式
   */
  parseMoves(data: string): ThumbnailMove[] {
    return new ThumbnailMoveParser().parse(data);
  }
}
