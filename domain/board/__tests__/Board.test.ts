import { describe, it, expect } from 'vitest';
import { Board } from '../Board.js';

describe('Board', () => {
  describe('构造', () => {
    it('默认19路棋盘', () => {
      const board = new Board();
      expect(board.size).toBe(19);
    });
    it('创建9路棋盘', () => {
      const board = new Board(9);
      expect(board.size).toBe(9);
    });
    it('创建13路棋盘', () => {
      const board = new Board(13);
      expect(board.size).toBe(13);
    });
  });

  describe('落子', () => {
    it('有效位置落子', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      expect(board.getStone(3, 3)).toBe('black');
    });
    it('空白位置返回null', () => {
      const board = new Board(19);
      expect(board.getStone(3, 3)).toBe(null);
    });
    it('无效位置返回null', () => {
      const board = new Board(19);
      expect(board.getStone(-1, 0)).toBe(null);
      expect(board.getStone(19, 0)).toBe(null);
    });
    it('提子（设置null）', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(3, 3, null);
      expect(board.getStone(3, 3)).toBe(null);
    });
  });

  describe('坐标验证', () => {
    it('有效坐标', () => {
      const board = new Board(19);
      expect(board.isValidPosition(0, 0)).toBe(true);
      expect(board.isValidPosition(18, 18)).toBe(true);
    });
    it('无效坐标', () => {
      const board = new Board(19);
      expect(board.isValidPosition(-1, 0)).toBe(false);
      expect(board.isValidPosition(19, 0)).toBe(false);
      expect(board.isValidPosition(0, -1)).toBe(false);
      expect(board.isValidPosition(0, 19)).toBe(false);
    });
    it('9路棋盘边界', () => {
      const board = new Board(9);
      expect(board.isValidPosition(8, 8)).toBe(true);
      expect(board.isValidPosition(9, 0)).toBe(false);
    });
  });

  describe('复制棋盘', () => {
    it('clone后独立', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      const cloned = board.clone();
      expect(cloned.getStone(3, 3)).toBe('black');
      board.setStone(3, 3, null);
      expect(cloned.getStone(3, 3)).toBe('black');
    });
    it('clone后可修改不影响原棋盘', () => {
      const board = new Board(19);
      const cloned = board.clone();
      cloned.setStone(5, 5, 'white');
      expect(board.getStone(5, 5)).toBe(null);
      expect(cloned.getStone(5, 5)).toBe('white');
    });
  });

  describe('序列化', () => {
    it('fromState恢复棋盘', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(15, 15, 'white');
      const state = board.getState();
      const restored = Board.fromState(state as any);
      expect(restored.getStone(3, 3)).toBe('black');
      expect(restored.getStone(15, 15)).toBe('white');
    });
    it('getState返回只读状态', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      const state = board.getState();
      expect(state[3]?.[3]).toBe('black');
    });
  });

  describe('统计', () => {
    it('countStones正确统计', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(15, 15, 'white');
      board.setStone(4, 4, 'black');
      const count = board.countStones();
      expect(count.black).toBe(2);
      expect(count.white).toBe(1);
    });
    it('空棋盘计数为0', () => {
      const board = new Board(19);
      const count = board.countStones();
      expect(count.black).toBe(0);
      expect(count.white).toBe(0);
    });
    it('getAllStones返回所有棋子', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(15, 15, 'white');
      const stones = board.getAllStones();
      expect(stones.length).toBe(2);
    });
  });

  describe('清空', () => {
    it('clear清空棋盘', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.clear();
      expect(board.getStone(3, 3)).toBe(null);
      const count = board.countStones();
      expect(count.black).toBe(0);
    });
  });
});