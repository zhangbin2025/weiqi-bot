/**
 * 题库筛选公共模块测试
 */
import { describe, it, expect } from 'vitest';
import {
  PUZZLE_FILTER_TYPES,
  PUZZLE_FILTER_DIFFICULTIES,
  defaultPuzzleFilterState,
  buildPuzzleKeyword,
} from '../puzzleFilter';

describe('puzzleFilter', () => {
  it('题型选项非空且首项为布局', () => {
    expect(PUZZLE_FILTER_TYPES.length).toBeGreaterThan(0);
    expect(PUZZLE_FILTER_TYPES[0]!.value).toBe('布局');
  });

  it('难度选项覆盖 30K~1K 与 1D~7D', () => {
    expect(PUZZLE_FILTER_DIFFICULTIES[0]).toBe('30K');
    expect(PUZZLE_FILTER_DIFFICULTIES).toContain('1K');
    expect(PUZZLE_FILTER_DIFFICULTIES).toContain('1D');
    expect(PUZZLE_FILTER_DIFFICULTIES[PUZZLE_FILTER_DIFFICULTIES.length - 1]).toBe('7D');
    // 30K..1K 共 30 个 + 1D..7D 共 7 个
    expect(PUZZLE_FILTER_DIFFICULTIES.length).toBe(37);
  });

  it('默认筛选状态为首项题型、无难度', () => {
    const st = defaultPuzzleFilterState();
    expect(st.types).toEqual(['布局']);
    expect(st.difficulty).toBe('');
  });

  it('单题型 + 难度生成 and 表达式', () => {
    expect(buildPuzzleKeyword(['死活'], '2D')).toBe('死活 and 2D');
  });

  it('多题型生成 or 括号表达式', () => {
    expect(buildPuzzleKeyword(['官子', '死活'], '2D')).toBe('(官子 or 死活) and 2D');
  });

  it('无难度时只含题型', () => {
    expect(buildPuzzleKeyword(['死活'], '')).toBe('死活');
  });

  it('空题型 + 有难度时只含难度', () => {
    expect(buildPuzzleKeyword([], '5D')).toBe('5D');
  });

  it('全空时返回空串（不筛选）', () => {
    expect(buildPuzzleKeyword([], '')).toBe('');
  });
});
