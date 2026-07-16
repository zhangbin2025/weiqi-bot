/**
 * GameResult 单元测试
 */
import { describe, it, expect } from 'vitest';
import { formatGameResult } from '../GameResult';

describe('formatGameResult', () => {
  it('should return "-" for undefined result', () => {
    expect(formatGameResult(undefined)).toBe('-');
  });

  it('should return "-" for empty string', () => {
    expect(formatGameResult('')).toBe('-');
  });

  it('should format B+R as 黑中盘胜', () => {
    expect(formatGameResult('B+R')).toBe('黑中盘胜');
  });

  it('should format W+R as 白中盘胜', () => {
    expect(formatGameResult('W+R')).toBe('白中盘胜');
  });

  it('should format B+T as 黑超时胜', () => {
    expect(formatGameResult('B+T')).toBe('黑超时胜');
  });

  it('should format W+T as 白超时胜', () => {
    expect(formatGameResult('W+T')).toBe('白超时胜');
  });

  it('should format numeric results correctly', () => {
    expect(formatGameResult('B+2.5')).toBe('黑胜2.5目');
    expect(formatGameResult('W+10')).toBe('白胜10目');
  });

  it('should return original value for unknown format', () => {
    expect(formatGameResult('unknown')).toBe('unknown');
  });
});
