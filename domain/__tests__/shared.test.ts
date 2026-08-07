import { describe, it, expect } from 'vitest';
import {
  getOpponentColor,
  sgfColorToPlayerColor,
  playerColorToSGFColor,
  createStone,
  isSamePosition,
  isSameStone,
  getStoneKey,
} from '../primitives';

describe('shared module', () => {
  describe('getOpponentColor', () => {
    it('should return white for black', () => {
      expect(getOpponentColor('black')).toBe('white');
    });
    it('should return black for white', () => {
      expect(getOpponentColor('white')).toBe('black');
    });
  });

  describe('sgfColorToPlayerColor', () => {
    it('should convert B to black', () => {
      expect(sgfColorToPlayerColor('B')).toBe('black');
    });
    it('should convert W to white', () => {
      expect(sgfColorToPlayerColor('W')).toBe('white');
    });
  });

  describe('playerColorToSGFColor', () => {
    it('should convert black to B', () => {
      expect(playerColorToSGFColor('black')).toBe('B');
    });
    it('should convert white to W', () => {
      expect(playerColorToSGFColor('white')).toBe('W');
    });
  });

  describe('createStone', () => {
    it('should create a stone with correct properties', () => {
      const stone = createStone(3, 3, 'black');
      expect(stone.x).toBe(3);
      expect(stone.y).toBe(3);
      expect(stone.color).toBe('black');
    });
  });

  describe('isSamePosition', () => {
    it('should return true for same position', () => {
      const stone1 = createStone(3, 3, 'black');
      const stone2 = createStone(3, 3, 'white');
      expect(isSamePosition(stone1, stone2)).toBe(true);
    });
    it('should return false for different positions', () => {
      const stone1 = createStone(3, 3, 'black');
      const stone2 = createStone(4, 4, 'black');
      expect(isSamePosition(stone1, stone2)).toBe(false);
    });
  });

  describe('isSameStone', () => {
    it('should return true for identical stones', () => {
      const stone1 = createStone(3, 3, 'black');
      const stone2 = createStone(3, 3, 'black');
      expect(isSameStone(stone1, stone2)).toBe(true);
    });
    it('should return false for different colors', () => {
      const stone1 = createStone(3, 3, 'black');
      const stone2 = createStone(3, 3, 'white');
      expect(isSameStone(stone1, stone2)).toBe(false);
    });
  });

  describe('getStoneKey', () => {
    it('should return correct key', () => {
      const stone = createStone(3, 3, 'black');
      expect(getStoneKey(stone)).toBe('3,3');
    });
  });
});