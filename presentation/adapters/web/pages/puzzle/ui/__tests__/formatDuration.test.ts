import { describe, it, expect } from 'vitest';
import { PuzzlePageUI } from '../PuzzlePageUI';

describe('PuzzlePageUI.formatDuration', () => {
  const ui = new PuzzlePageUI({} as never);
  const f = (ms: number): string => (ui as unknown as { formatDuration(ms: number): string }).formatDuration(ms);
  it('45s -> 45 秒', () => expect(f(45000)).toBe('45 秒'));
  it('90s -> 1 分 30 秒', () => expect(f(90000)).toBe('1 分 30 秒'));
  it('120s -> 2 分', () => expect(f(120000)).toBe('2 分'));
  it('0 -> 0 秒', () => expect(f(0)).toBe('0 秒'));
  it('负数归零', () => expect(f(-5000)).toBe('0 秒'));
  it('59.6s 四舍五入 -> 60 秒? 应为 1 分', () => expect(f(59600)).toBe('1 分'));
});
