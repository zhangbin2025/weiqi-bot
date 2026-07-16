/**
 * 角坐标转换器单元测试
 */

import { describe, it, expect } from 'vitest';
import { convertToTopRight, normalizeCornerSequence, compareCoordSequences } from '../CornerConverter';

describe('convertToTopRight', () => {
  it('右上角应不变', () => {
    expect(convertToTopRight(['pd', 'dd'], 'tr')).toEqual(['pd', 'dd']);
  });

  it('左上角应镜像 x 坐标', () => {
    // 左上角 -> 右上角: (col, row) -> (18-col, row)
    // dd (3, 3) -> pd (15, 3)
    // dp (3, 15) -> pp (15, 15)
    expect(convertToTopRight(['dd', 'dp'], 'tl')).toEqual(['pd', 'pp']);
  });

  it('左下角应镜像 x 和 y 坐标', () => {
    // 左下角 -> 右上角: (col, row) -> (18-col, 18-row)
    // dd (3, 3) -> pp (15, 15)
    expect(convertToTopRight(['dd'], 'bl')).toEqual(['pp']);
  });

  it('右下角应镜像 y 坐标', () => {
    // 右下角 -> 右上角: (col, row) -> (col, 18-row)
    // pd (15, 3) -> (15, 15) = pp
    expect(convertToTopRight(['pd'], 'br')).toEqual(['pp']);
  });

  it('应处理空坐标', () => {
    expect(convertToTopRight([], 'tr')).toEqual([]);
  });

  it('应处理 pass 和 tt', () => {
    expect(convertToTopRight(['tt', 'pd', 'pass'], 'tr')).toEqual(['tt', 'pd', 'pass']);
  });

  it('应处理多个坐标', () => {
    // 左上角 -> 右上角
    // dd (3, 3) -> pd (15, 3)
    // dc (3, 2) -> pc (15, 2)
    // pp (15, 15) -> dp (3, 15)
    expect(convertToTopRight(['dd', 'dc', 'pp'], 'tl')).toEqual(['pd', 'pc', 'dp']);
  });
});

describe('normalizeCornerSequence', () => {
  it('应返回归一化序列', () => {
    const result = normalizeCornerSequence(['pd', 'dd', 'pp']);
    expect(result.normalized).toBeDefined();
    expect(result.mirrored).toBeDefined();
  });

  it('对角线上的坐标应保持不变', () => {
    // sa (18, 0) -> col + row = 18 (对角线)
    const result = normalizeCornerSequence(['sa', 'sa']);
    expect(result.normalized).toEqual(['sa', 'sa']);
    expect(result.mirrored).toBe(false);
  });

  it('上半部分的坐标应保持不变', () => {
    // pd (15, 3) -> col + row = 18 (对角线)
    // dd (3, 3) -> col + row = 6 < 18 (上半部分)
    const result = normalizeCornerSequence(['dd', 'pd']);
    expect(result.mirrored).toBe(false);
  });

  it('下半部分的坐标应被镜像', () => {
    // pp (15, 15) -> col + row = 30 > 18 (下半部分)
    // 镜像后: (18-15, 18-15) = (3, 3) -> dd
    const result = normalizeCornerSequence(['pp', 'pd']);
    expect(result.mirrored).toBe(true);
    expect(result.normalized[0]).toBe('dd');
  });

  it('应处理空序列', () => {
    const result = normalizeCornerSequence([]);
    expect(result.normalized).toEqual([]);
    expect(result.mirrored).toBe(false);
  });

  it('应处理 pass 和 tt', () => {
    const result = normalizeCornerSequence(['tt', 'pd', 'pass']);
    expect(result.normalized).toContain('tt');
    expect(result.normalized).toContain('pass');
  });
});

describe('compareCoordSequences', () => {
  it('应正确比较相同序列', () => {
    expect(compareCoordSequences(['aa', 'bb'], ['aa', 'bb'])).toBe(0);
  });

  it('应正确比较不同序列', () => {
    expect(compareCoordSequences(['aa', 'bb'], ['aa', 'cc'])).toBe(-1);
    expect(compareCoordSequences(['aa', 'cc'], ['aa', 'bb'])).toBe(1);
  });

  it('应正确比较不同长度的序列', () => {
    expect(compareCoordSequences(['aa'], ['aa', 'bb'])).toBe(-1);
    expect(compareCoordSequences(['aa', 'bb'], ['aa'])).toBe(1);
  });

  it('应处理空序列', () => {
    expect(compareCoordSequences([], [])).toBe(0);
    expect(compareCoordSequences([], ['aa'])).toBe(-1);
    expect(compareCoordSequences(['aa'], [])).toBe(1);
  });
});