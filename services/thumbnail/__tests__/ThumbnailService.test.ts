/**
 * ThumbnailService 单元测试
 * @module services/thumbnail/__tests__/ThumbnailService.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ThumbnailService } from '../ThumbnailService';

describe('ThumbnailService', () => {
  let service: ThumbnailService;

  beforeEach(() => {
    service = new ThumbnailService();
  });

  describe('buildBoardState', () => {
    it('应正确构建空棋盘', () => {
      const board = service.buildBoardState([]);
      expect(board.countStones()).toEqual({ black: 0, white: 0 });
    });

    it('应正确设置棋子', () => {
      const moves = [
        { x: 3, y: 3, color: 'black' as const },
        { x: 4, y: 4, color: 'white' as const },
      ];
      const board = service.buildBoardState(moves);
      expect(board.getStone(3, 3)).toBe('black');
      expect(board.getStone(4, 4)).toBe('white');
      expect(board.countStones()).toEqual({ black: 1, white: 1 });
    });

    it('应正确处理提子', () => {
      // 白子在(0,0)，黑子包围
      const moves = [
        { x: 0, y: 0, color: 'white' as const },
        { x: 1, y: 0, color: 'black' as const },
        { x: 0, y: 1, color: 'black' as const },
      ];
      const board = service.buildBoardState(moves);
      // (0,0) 应被提掉
      expect(board.getStone(0, 0)).toBeNull();
      expect(board.countStones()).toEqual({ black: 2, white: 0 });
    });

    it('应忽略 pass 着法', () => {
      const moves = [
        { x: 3, y: 3, color: 'black' as const },
        { x: -1, y: -1, color: 'white' as const, isPass: true },
        { x: 4, y: 4, color: 'white' as const },
      ];
      const board = service.buildBoardState(moves);
      expect(board.countStones()).toEqual({ black: 1, white: 1 });
    });

    it('应忽略无效坐标', () => {
      const moves = [
        { x: 3, y: 3, color: 'black' as const },
        { x: 100, y: 100, color: 'white' as const },
        { x: -5, y: -5, color: 'white' as const },
      ];
      const board = service.buildBoardState(moves);
      expect(board.countStones()).toEqual({ black: 1, white: 0 });
    });
  });

  describe('parseMoves', () => {
    it('应解析 JSON 格式', () => {
      const moves = service.parseMoves('[{"x":3,"y":3,"color":"black"}]');
      expect(moves).toHaveLength(1);
      expect(moves[0]).toEqual({ x: 3, y: 3, color: 'black' });
    });

    it('应解析 SGF 格式', () => {
      const moves = service.parseMoves('(;GM[1];B[dd];W[pp])');
      expect(moves).toHaveLength(2);
      expect(moves[0]).toEqual({ x: 3, y: 3, color: 'black', isPass: false });
      expect(moves[1]).toEqual({ x: 15, y: 15, color: 'white', isPass: false });
    });

    it('应解析坐标字符串格式', () => {
      const moves = service.parseMoves('dd pp');
      expect(moves).toHaveLength(2);
      expect(moves[0]).toEqual({ x: 3, y: 3, color: 'black', isPass: false });
      expect(moves[1]).toEqual({ x: 15, y: 15, color: 'white', isPass: false });
    });

    it('应返回空数组对于无效输入', () => {
      expect(service.parseMoves('')).toEqual([]);
    });

    it('应处理 JSON 数组中的无效项', () => {
      const moves = service.parseMoves('[{"x":3,"y":3,"color":"black"},{"x":"invalid"}]');
      expect(moves).toHaveLength(1);
      expect(moves[0]).toEqual({ x: 3, y: 3, color: 'black' });
    });
  });
});
