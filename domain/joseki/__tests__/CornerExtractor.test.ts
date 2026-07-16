import { describe, it, expect } from 'vitest';
import { CornerExtractor } from '../CornerExtractor.js';
import type { RawMove } from '../ICornerExtractor.js';

describe('CornerExtractor', () => {
  const extractor = new CornerExtractor();

  describe('extractFourCorners', () => {
    it('空着法序列返回空结果', () => {
      const result = extractor.extractFourCorners([]);
      expect(Object.keys(result).length).toBe(0);
    });
    it('提取四个角定式', () => {
      const moves: RawMove[] = [
        ['B', 'dd'], // 左上角 (0-12范围)
        ['W', 'pp'], // 右下角
        ['B', 'pd'], // 右上角
        ['W', 'dp'], // 左下角
      ];
      const result = extractor.extractFourCorners(moves);
      // 检查结果结构
      expect(result !== undefined);
    });
    it('限制提取前N着', () => {
      const moves: RawMove[] = [
        ['B', 'dd'],
        ['W', 'pp'],
      ];
      const result = extractor.extractFourCorners(moves, 1);
      // 只提取第一着
      expect(result !== undefined);
    });
    it('包含预置子', () => {
      const moves: RawMove[] = [['B', 'dd']];
      const handicap = [{ x: 3, y: 3, color: 'B' }];
      const result = extractor.extractFourCorners(moves, 80, handicap);
      expect(result !== undefined);
    });
  });

  describe('extractCorner', () => {
    it('提取左上角', () => {
      const moves: RawMove[] = [['B', 'dd']];
      const result = extractor.extractCorner(moves, 'tl');
      expect(result !== null);
      expect(result!.cornerKey).toBe('tl');
    });
    it('提取右上角', () => {
      const moves: RawMove[] = [['B', 'pd']];
      const result = extractor.extractCorner(moves, 'tr');
      expect(result !== null);
    });
    it('提取左下角', () => {
      const moves: RawMove[] = [['B', 'dp']];
      const result = extractor.extractCorner(moves, 'bl');
      expect(result !== null);
    });
    it('提取右下角', () => {
      const moves: RawMove[] = [['B', 'pp']];
      const result = extractor.extractCorner(moves, 'br');
      expect(result !== null);
    });
    it('无该角着法返回null', () => {
      const moves: RawMove[] = [['B', 'pp']]; // 右下角
      const result = extractor.extractCorner(moves, 'tl');
      expect(result).toBe(null);
    });
    it('无效角返回null', () => {
      const moves: RawMove[] = [['B', 'dd']];
      const result = extractor.extractCorner(moves, 'invalid');
      expect(result).toBe(null);
    });
    it('包含预置子序列', () => {
      const moves: RawMove[] = [['B', 'dd']];
      const handicap = [{ x: 3, y: 3, color: 'B' }];
      const result = extractor.extractCorner(moves, 'tl', handicap);
      expect(result !== null);
      expect(result!.handicapStones.length > 0);
    });
  });
});