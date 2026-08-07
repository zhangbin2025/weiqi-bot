import { describe, it, expect } from 'vitest';
import { LibertyCalculator, CaptureRule, KoRule, SuicideRule } from '../rules';
import { Board } from '../board';

describe('rules module', () => {
  describe('LibertyCalculator', () => {
    const calc = new LibertyCalculator();

    it('should count liberties for single stone', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      expect(calc.countLiberties(board, 3, 3)).toBe(4);
    });

    it('should count liberties for corner stone', () => {
      const board = new Board(19);
      board.setStone(0, 0, 'black');
      expect(calc.countLiberties(board, 0, 0)).toBe(2);
    });

    it('should count liberties for group', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(4, 3, 'black');
      expect(calc.countLiberties(board, 3, 3)).toBe(6);
    });

    it('should find group correctly', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(4, 3, 'black');
      const group = calc.findGroup(board, 3, 3);
      expect(group.stones.length).toBe(2);
      expect(group.color).toBe('black');
    });
  });

  describe('CaptureRule', () => {
    const rule = new CaptureRule();

    it('should return empty result when no capture', () => {
      const board = new Board(19);
      const result = rule.capture(board, 9, 9, 'black');
      expect(result.count).toBe(0);
    });
  });

  describe('SuicideRule', () => {
    const rule = new SuicideRule();

    it('should detect suicide', () => {
      const board = new Board(19);
      board.setStone(1, 0, 'white');
      board.setStone(0, 1, 'white');
      expect(rule.isSuicide(board, 0, 0, 'black')).toBe(true);
    });

    it('should allow move with liberties', () => {
      const board = new Board(19);
      expect(rule.isSuicide(board, 9, 9, 'black')).toBe(false);
    });
  });

  describe('KoRule', () => {
    const rule = new KoRule();

    it('should detect ko when single capture and opponent can recapture exactly one', () => {
      // 标准劫形：黑(3,2)只有1气(3,3)，白在(3,3)落子只提1子
      const board = new Board(19);
      board.setStone(3, 1, 'white');
      board.setStone(2, 2, 'white');
      board.setStone(4, 2, 'white');
      board.setStone(3, 2, 'black');
      board.setStone(2, 3, 'white');
      board.setStone(4, 3, 'white');
      board.setStone(3, 4, 'black');
      const koState = rule.detectKo(board, 1, { x: 3, y: 3 }, 'black');
      expect(koState.isActive).toBe(true);
      expect(koState.forbiddenPosition).toEqual({ x: 3, y: 3 });
    });

    it('should not detect ko for multiple captures', () => {
      const board = new Board(19);
      const koState = rule.detectKo(board, 2, { x: 3, y: 3 }, 'black');
      expect(koState.isActive).toBe(false);
    });

    it('should not detect ko for snapback (打二还一)', () => {
      // 打二还一：提1子但对方能提回多于1子
      const board = new Board(19);
      board.setStone(3, 1, 'white');
      board.setStone(2, 2, 'white');
      board.setStone(4, 2, 'white');
      board.setStone(3, 2, 'black');
      board.setStone(2, 3, 'white');
      board.setStone(4, 3, 'white');
      board.setStone(3, 4, 'black');
      board.setStone(3, 5, 'black');
      board.setStone(2, 4, 'white');
      board.setStone(4, 4, 'white');
      board.setStone(2, 5, 'white');
      board.setStone(4, 5, 'white');
      board.setStone(3, 6, 'white');
      const koState = rule.detectKo(board, 1, { x: 3, y: 3 }, 'black');
      expect(koState.isActive).toBe(false);
    });

    it('should not detect ko when opponent cannot recapture', () => {
      const board = new Board(19);
      const koState = rule.detectKo(board, 1, { x: 3, y: 3 }, 'black');
      expect(koState.isActive).toBe(false);
    });
  });
});
