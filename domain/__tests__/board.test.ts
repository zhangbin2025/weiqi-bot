import { describe, it, expect } from 'vitest';
import {
  getStarPoints,
  isStarPoint,
  getHandicapPoints,
  createPosition,
  isEmptyPosition,
  hasStone,
  createEmptyBoardState,
  Board,
} from '../board';

describe('board module', () => {
  describe('getStarPoints', () => {
    it('should return 9 star points for 19x19 board', () => {
      const stars = getStarPoints(19);
      expect(stars).toHaveLength(9);
    });
    it('should return correct star points for 9x9 board', () => {
      const stars = getStarPoints(9);
      expect(stars).toHaveLength(5);
    });
  });

  describe('isStarPoint', () => {
    it('should return true for star point', () => {
      expect(isStarPoint(3, 3, 19)).toBe(true);
    });
    it('should return false for non-star point', () => {
      expect(isStarPoint(0, 0, 19)).toBe(false);
    });
  });

  describe('getHandicapPoints', () => {
    it('should return correct number of handicap points', () => {
      const points = getHandicapPoints(2, 19);
      expect(points).toHaveLength(2);
    });
    it('should return empty array for non-19 board', () => {
      const points = getHandicapPoints(2, 9);
      expect(points).toHaveLength(0);
    });
  });

  describe('createPosition', () => {
    it('should create position with default null state', () => {
      const pos = createPosition(3, 3);
      expect(pos.x).toBe(3);
      expect(pos.y).toBe(3);
      expect(pos.state).toBeNull();
    });
    it('should create position with specified state', () => {
      const pos = createPosition(3, 3, 'black');
      expect(pos.state).toBe('black');
    });
  });

  describe('isEmptyPosition', () => {
    it('should return true for empty position', () => {
      const pos = createPosition(3, 3, null);
      expect(isEmptyPosition(pos)).toBe(true);
    });
    it('should return false for occupied position', () => {
      const pos = createPosition(3, 3, 'black');
      expect(isEmptyPosition(pos)).toBe(false);
    });
  });

  describe('hasStone', () => {
    it('should return true for correct color', () => {
      const pos = createPosition(3, 3, 'black');
      expect(hasStone(pos, 'black')).toBe(true);
    });
    it('should return false for wrong color', () => {
      const pos = createPosition(3, 3, 'black');
      expect(hasStone(pos, 'white')).toBe(false);
    });
  });

  describe('createEmptyBoardState', () => {
    it('should create empty board state', () => {
      const state = createEmptyBoardState(19);
      expect(state.length).toBe(19);
      expect(state[0]?.length).toBe(19);
      expect(state[0]?.[0]).toBeNull();
    });
  });

  describe('Board', () => {
    it('should create board with correct size', () => {
      const board = new Board(19);
      expect(board.size).toBe(19);
    });

    it('should set and get stone', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      expect(board.getStone(3, 3)).toBe('black');
    });

    it('should return null for empty position', () => {
      const board = new Board(19);
      expect(board.getStone(3, 3)).toBeNull();
    });

    it('should validate positions', () => {
      const board = new Board(19);
      expect(board.isValidPosition(0, 0)).toBe(true);
      expect(board.isValidPosition(-1, 0)).toBe(false);
      expect(board.isValidPosition(19, 0)).toBe(false);
    });

    it('should clone board', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      const cloned = board.clone();
      expect(cloned.getStone(3, 3)).toBe('black');
      // Modify original should not affect clone
      board.setStone(3, 3, null);
      expect(cloned.getStone(3, 3)).toBe('black');
    });

    it('should count stones', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(15, 15, 'white');
      const count = board.countStones();
      expect(count.black).toBe(1);
      expect(count.white).toBe(1);
    });
  });
});