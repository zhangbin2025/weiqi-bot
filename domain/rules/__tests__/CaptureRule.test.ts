import { describe, it, expect } from 'vitest';
import { CaptureRule } from '../CaptureRule.js';
import { Board } from '../../board/Board.js';

describe('CaptureRule', () => {
  const rule = new CaptureRule();

  describe('capture', () => {
    it('提掉角上无气的单子', () => {
      const board = new Board(19);
      board.setStone(0, 0, 'white');
      board.setStone(1, 0, 'black');
      board.setStone(0, 1, 'black');
      const result = rule.capture(board, 1, 0, 'black');
      expect(result.count).toBe(1);
      expect(result.captured[0].x).toBe(0);
      expect(result.captured[0].y).toBe(0);
    });

    it('提掉边上无气的单子', () => {
      const board = new Board(19);
      board.setStone(5, 0, 'white');
      board.setStone(4, 0, 'black');
      board.setStone(6, 0, 'black');
      board.setStone(5, 1, 'black');
      const result = rule.capture(board, 4, 0, 'black');
      expect(result.count).toBe(1);
    });

    it('不能提有气的棋子', () => {
      const board = new Board(19);
      board.setStone(5, 5, 'white');
      const result = rule.capture(board, 3, 3, 'black');
      expect(result.count).toBe(0);
    });

    it('提掉多个相连无气的子', () => {
      const board = new Board(19);
      board.setStone(0, 0, 'white');
      board.setStone(1, 0, 'white');
      board.setStone(2, 0, 'black');
      board.setStone(0, 1, 'black');
      board.setStone(1, 1, 'black');
      const result = rule.capture(board, 2, 0, 'black');
      expect(result.count).toBe(2);
    });

    it('对方棋子有气时不提', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'white');
      board.setStone(3, 4, 'black');
      const result = rule.capture(board, 3, 4, 'black');
      expect(result.count).toBe(0);
    });

    it('落子位置无相邻对方子时不提', () => {
      const board = new Board(19);
      const result = rule.capture(board, 3, 3, 'black');
      expect(result.count).toBe(0);
    });
  });
});