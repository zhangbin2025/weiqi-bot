import { describe, it, expect } from 'vitest';
import { KoRule } from '../KoRule.js';
import { Board } from '../../board/Board.js';
import { createCoordinate } from '../../coordinate/ICoordinate.js';

describe('KoRule', () => {
  const rule = new KoRule();

  describe('isKoViolation', () => {
    it('无前一状态时不违规', () => {
      const board = new Board(19);
      expect(rule.isKoViolation(board, null, 3, 3)).toBe(false);
    });
    it('相同状态违规', () => {
      const board1 = new Board(19);
      board1.setStone(3, 3, 'black');
      const board2 = new Board(19);
      board2.setStone(3, 3, 'black');
      expect(rule.isKoViolation(board1, board2, 5, 5)).toBe(true);
    });
    it('不同状态不违规', () => {
      const board1 = new Board(19);
      board1.setStone(3, 3, 'black');
      const board2 = new Board(19);
      board2.setStone(3, 3, 'white');
      expect(rule.isKoViolation(board1, board2, 5, 5)).toBe(false);
    });
    it('棋盘大小不同不违规', () => {
      const board1 = new Board(19);
      const board2 = new Board(9);
      expect(rule.isKoViolation(board1, board2, 3, 3)).toBe(false);
    });
  });

  describe('detectKo', () => {
    it('提单子可能形成劫', () => {
      const board = new Board(19);
      const pos = createCoordinate(3, 3);
      const result = rule.detectKo(board, 1, pos);
      expect(result.isActive).toBe(true);
      expect(result.forbiddenPosition?.x).toBe(3);
      expect(result.forbiddenPosition?.y).toBe(3);
    });
    it('提多子不形成劫', () => {
      const board = new Board(19);
      const pos = createCoordinate(3, 3);
      const result = rule.detectKo(board, 2, pos);
      expect(result.isActive).toBe(false);
      expect(result.forbiddenPosition).toBe(null);
    });
    it('提零子不形成劫', () => {
      const board = new Board(19);
      const pos = createCoordinate(3, 3);
      const result = rule.detectKo(board, 0, pos);
      expect(result.isActive).toBe(false);
    });
  });
});