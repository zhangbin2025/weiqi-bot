import { describe, it, expect } from 'vitest';
import { CoordinateConverter } from '../CoordinateConverter.js';

describe('CoordinateConverter', () => {
  describe('SGF坐标转换', () => {
    it('sgfToCoordinate: dd → {x:3, y:3}', () => {
      const conv = new CoordinateConverter(19);
      const coord = conv.sgfToCoordinate('dd');
      expect(coord.x).toBe(3);
      expect(coord.y).toBe(3);
    });
    it('sgfToCoordinate: pd → {x:15, y:3}', () => {
      const conv = new CoordinateConverter(19);
      const coord = conv.sgfToCoordinate('pd');
      expect(coord.x).toBe(15);
      expect(coord.y).toBe(3);
    });
    it('sgfToCoordinate: ss → {x:18, y:18}', () => {
      const conv = new CoordinateConverter(19);
      const coord = conv.sgfToCoordinate('ss');
      expect(coord.x).toBe(18);
      expect(coord.y).toBe(18);
    });
    it('sgfToCoordinate抛错：单字符', () => {
      const conv = new CoordinateConverter(19);
      expect(() => conv.sgfToCoordinate('d'));
    });
    it('sgfToCoordinate抛错：空字符串', () => {
      const conv = new CoordinateConverter(19);
      expect(() => conv.sgfToCoordinate(''));
    });
  });

  describe('数字坐标转SGF', () => {
    it('coordinateToSGF: {x:3,y:3} → dd', () => {
      const conv = new CoordinateConverter(19);
      expect(conv.coordinateToSGF({ x: 3, y: 3 })).toBe('dd');
    });
    it('coordinateToSGF: {x:0,y:0} → aa', () => {
      const conv = new CoordinateConverter(19);
      expect(conv.coordinateToSGF({ x: 0, y: 0 })).toBe('aa');
    });
    it('coordinateToSGF: {x:18,y:18} → ss', () => {
      const conv = new CoordinateConverter(19);
      expect(conv.coordinateToSGF({ x: 18, y: 18 })).toBe('ss');
    });
  });

  describe('显示坐标转换', () => {
    it('coordinateToDisplay: {x:3,y:3} → D16 (跳过I)', () => {
      const conv = new CoordinateConverter(19);
      expect(conv.coordinateToDisplay({ x: 3, y: 3 })).toBe('D16');
    });
    it('coordinateToDisplay: {x:8,y:3} → J16 (跳过I)', () => {
      const conv = new CoordinateConverter(19);
      expect(conv.coordinateToDisplay({ x: 8, y: 3 })).toBe('J16');
    });
    it('coordinateToDisplay: {x:0,y:0} → A19', () => {
      const conv = new CoordinateConverter(19);
      expect(conv.coordinateToDisplay({ x: 0, y: 0 })).toBe('A19');
    });
    it('coordinateToDisplay: {x:18,y:18} → T1', () => {
      const conv = new CoordinateConverter(19);
      expect(conv.coordinateToDisplay({ x: 18, y: 18 })).toBe('T1');
    });
    it('9路棋盘显示坐标', () => {
      const conv = new CoordinateConverter(9);
      expect(conv.coordinateToDisplay({ x: 0, y: 0 })).toBe('A9');
      expect(conv.coordinateToDisplay({ x: 8, y: 8 })).toBe('J1');
    });
  });

  describe('显示坐标转数字', () => {
    it('displayToCoordinate: D16 → {x:3,y:3}', () => {
      const conv = new CoordinateConverter(19);
      const coord = conv.displayToCoordinate('D16');
      expect(coord !== null);
      expect(coord!.x).toBe(3);
      expect(coord!.y).toBe(3);
    });
    it('displayToCoordinate: A19 → {x:0,y:0}', () => {
      const conv = new CoordinateConverter(19);
      const coord = conv.displayToCoordinate('A19');
      expect(coord !== null);
      expect(coord!.x).toBe(0);
      expect(coord!.y).toBe(0);
    });
    it('displayToCoordinate: T1 → {x:18,y:18}', () => {
      const conv = new CoordinateConverter(19);
      const coord = conv.displayToCoordinate('T1');
      expect(coord !== null);
      expect(coord!.x).toBe(18);
      expect(coord!.y).toBe(18);
    });
    it('displayToCoordinate: J16 → {x:8,y:3} (跳过I)', () => {
      const conv = new CoordinateConverter(19);
      const coord = conv.displayToCoordinate('J16');
      expect(coord !== null);
      expect(coord!.x).toBe(8);
      expect(coord!.y).toBe(3);
    });
    it('displayToCoordinate无效返回null', () => {
      const conv = new CoordinateConverter(19);
      expect(conv.displayToCoordinate('')).toBe(null);
      expect(conv.displayToCoordinate('X99')).toBe(null);
    });
    it('displayToCoordinate超出边界返回null', () => {
      const conv = new CoordinateConverter(9);
      expect(conv.displayToCoordinate('K5')).toBe(null);
    });
  });

  describe('批量转换', () => {
    it('batchSGFToCoordinates', () => {
      const conv = new CoordinateConverter(19);
      const coords = conv.batchSGFToCoordinates(['dd', 'pp']);
      expect(coords.length).toBe(2);
      expect(coords[0].x).toBe(3);
      expect(coords[1].x).toBe(15);
    });
    it('batchCoordinatesToSGF', () => {
      const conv = new CoordinateConverter(19);
      const sgfs = conv.batchCoordinatesToSGF([{ x: 3, y: 3 }, { x: 15, y: 15 }]);
      expect(sgfs.length).toBe(2);
      expect(sgfs[0]).toBe('dd');
      expect(sgfs[1]).toBe('pp');
    });
  });
});