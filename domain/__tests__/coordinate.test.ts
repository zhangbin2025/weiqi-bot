import { describe, it, expect } from 'vitest';
import {
  createCoordinate,
  getCoordinateKey,
  isSameCoordinate,
  getManhattanDistance,
  getAdjacentCoordinates,
  CoordinateConverter,
  getCornerRanges,
  getCornerConfigs,
} from '../coordinate';

describe('coordinate module', () => {
  describe('createCoordinate', () => {
    it('should create a coordinate with correct properties', () => {
      const coord = createCoordinate(3, 3);
      expect(coord.x).toBe(3);
      expect(coord.y).toBe(3);
    });
  });

  describe('getCoordinateKey', () => {
    it('should return correct key', () => {
      const coord = createCoordinate(3, 3);
      expect(getCoordinateKey(coord)).toBe('3,3');
    });
  });

  describe('isSameCoordinate', () => {
    it('should return true for same coordinates', () => {
      const coord1 = createCoordinate(3, 3);
      const coord2 = createCoordinate(3, 3);
      expect(isSameCoordinate(coord1, coord2)).toBe(true);
    });
    it('should return false for different coordinates', () => {
      const coord1 = createCoordinate(3, 3);
      const coord2 = createCoordinate(4, 4);
      expect(isSameCoordinate(coord1, coord2)).toBe(false);
    });
  });

  describe('getManhattanDistance', () => {
    it('should calculate correct distance', () => {
      const coord1 = createCoordinate(3, 3);
      const coord2 = createCoordinate(5, 5);
      expect(getManhattanDistance(coord1, coord2)).toBe(4);
    });
  });

  describe('getAdjacentCoordinates', () => {
    it('should return 4 adjacent positions for center', () => {
      const coord = createCoordinate(3, 3);
      const adjacent = getAdjacentCoordinates(coord, 19);
      expect(adjacent).toHaveLength(4);
    });
    it('should return 2 adjacent positions for corner', () => {
      const coord = createCoordinate(0, 0);
      const adjacent = getAdjacentCoordinates(coord, 19);
      expect(adjacent).toHaveLength(2);
    });
  });

  describe('CoordinateConverter', () => {
    const converter = new CoordinateConverter(19);

    describe('sgfToCoordinate', () => {
      it('should convert SGF coordinate to numeric', () => {
        const coord = converter.sgfToCoordinate('dd');
        expect(coord.x).toBe(3);
        expect(coord.y).toBe(3);
      });
      it('should throw for invalid SGF coordinate', () => {
        expect(() => converter.sgfToCoordinate('d')).toThrow();
      });
    });

    describe('coordinateToSGF', () => {
      it('should convert numeric coordinate to SGF', () => {
        const sgf = converter.coordinateToSGF({ x: 3, y: 3 });
        expect(sgf).toBe('dd');
      });
    });

    describe('coordinateToDisplay', () => {
      it('should convert to display coordinate', () => {
        const display = converter.coordinateToDisplay({ x: 3, y: 3 });
        // D16 (x=3 -> D, y=3 -> 19-3=16)
        expect(display).toBe('D16');
      });
    });

    describe('displayToCoordinate', () => {
      it('should convert display coordinate to numeric', () => {
        const coord = converter.displayToCoordinate('D16');
        expect(coord?.x).toBe(3);
        expect(coord?.y).toBe(3);
      });
      it('should return null for invalid display coordinate', () => {
        expect(converter.displayToCoordinate('')).toBeNull();
      });
    });
  });

  describe('getCornerRanges', () => {
    it('should return correct ranges for 13 lu', () => {
      const ranges = getCornerRanges(13);
      expect(ranges.tl.colMin).toBe(0);
      expect(ranges.tl.colMax).toBe(12);
    });
  });

  describe('getCornerConfigs', () => {
    it('should return 4 corner configs', () => {
      const configs = getCornerConfigs(13);
      expect(configs).toHaveLength(4);
    });
  });
});