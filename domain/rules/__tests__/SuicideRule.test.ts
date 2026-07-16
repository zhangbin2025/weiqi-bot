import { describe, it, expect } from 'vitest';
import { SuicideRule } from '../SuicideRule.js';
import { Board } from '../../board/Board.js';

describe('SuicideRule', () => {
  const rule = new SuicideRule();

  describe('isSuicide', () => {
    it('角上被完全包围是自杀', () => {
      const board = new Board(19);
      board.setStone(1, 0, 'white');
      board.setStone(0, 1, 'white');
      expect(rule.isSuicide(board, 0, 0, 'black')).toBe(true);
    });
    it('边上被完全包围是自杀', () => {
      const board = new Board(19);
      board.setStone(4, 0, 'white');
      board.setStone(6, 0, 'white');
      board.setStone(5, 1, 'white');
      expect(rule.isSuicide(board, 5, 0, 'black')).toBe(true);
    });
    it('中心被完全包围是自杀', () => {
      const board = new Board(19);
      board.setStone(3, 4, 'white');
      board.setStone(5, 4, 'white');
      board.setStone(4, 3, 'white');
      board.setStone(4, 5, 'white');
      expect(rule.isSuicide(board, 4, 4, 'black')).toBe(true);
    });
    it('有气不是自杀', () => {
      const board = new Board(19);
      expect(rule.isSuicide(board, 3, 3, 'black')).toBe(false);
    });
    it('能提对方子不是自杀', () => {
      const board = new Board(19);
      board.setStone(1, 0, 'white');
      board.setStone(0, 1, 'white');
      board.setStone(2, 0, 'black');
      board.setStone(1, 1, 'black');
      // 落(0,0)能提白(1,0)所以不是自杀
      expect(rule.isSuicide(board, 0, 0, 'black')).toBe(false);
    });
    it('已有棋子位置返回false', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      expect(rule.isSuicide(board, 3, 3, 'white')).toBe(false);
    });
    it('部分包围有气不是自杀', () => {
      const board = new Board(19);
      board.setStone(3, 4, 'white');
      board.setStone(4, 3, 'white');
      // (4,4)还有两个气位
      expect(rule.isSuicide(board, 4, 4, 'black')).toBe(false);
    });
  });
});