import { describe, it, expect } from 'vitest';
import { LibertyCalculator } from '../LibertyCalculator.js';
import { Board } from '../../board/Board.js';

describe('LibertyCalculator', () => {
  const calc = new LibertyCalculator();

  describe('countLiberties', () => {
    it('单个中心子有4气', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      expect(calc.countLiberties(board, 3, 3)).toBe(4);
    });
    it('边上的子有3气', () => {
      const board = new Board(19);
      board.setStone(0, 3, 'black');
      expect(calc.countLiberties(board, 0, 3)).toBe(3);
    });
    it('角上的子有2气', () => {
      const board = new Board(19);
      board.setStone(0, 0, 'black');
      expect(calc.countLiberties(board, 0, 0)).toBe(2);
    });
    it('空位返回0', () => {
      const board = new Board(19);
      expect(calc.countLiberties(board, 3, 3)).toBe(0);
    });
    it('被围住的子0气', () => {
      const board = new Board(19);
      board.setStone(0, 0, 'black');
      board.setStone(1, 0, 'white');
      board.setStone(0, 1, 'white');
      expect(calc.countLiberties(board, 0, 0)).toBe(0);
    });
    it('两子相连共享气', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(4, 3, 'black');
      expect(calc.countLiberties(board, 3, 3)).toBe(6);
    });
  });

  describe('getLiberties', () => {
    it('返回气位坐标列表', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      const libs = calc.getLiberties(board, 3, 3);
      expect(libs.length).toBe(4);
    });
    it('空位返回空数组', () => {
      const board = new Board(19);
      const libs = calc.getLiberties(board, 5, 5);
      expect(libs.length).toBe(0);
    });
  });

  describe('findGroup', () => {
    it('单个子连通块', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      const group = calc.findGroup(board, 3, 3);
      expect(group.stones.length).toBe(1);
      expect(group.color).toBe('black');
    });
    it('相连同色子为同一组', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(3, 4, 'black');
      const group = calc.findGroup(board, 3, 3);
      expect(group.stones.length).toBe(2);
    });
    it('异色子不在同一组', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(3, 4, 'white');
      const group = calc.findGroup(board, 3, 3);
      expect(group.stones.length).toBe(1);
    });
    it('空位返回空组', () => {
      const board = new Board(19);
      const group = calc.findGroup(board, 5, 5);
      expect(group.stones.length).toBe(0);
    });
    it('大的连通块', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(4, 3, 'black');
      board.setStone(4, 4, 'black');
      board.setStone(3, 4, 'black');
      const group = calc.findGroup(board, 3, 3);
      expect(group.stones.length).toBe(4);
    });
  });
});