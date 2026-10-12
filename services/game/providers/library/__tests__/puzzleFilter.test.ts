/**
 * 题库筛选公共模块测试
 */
import { describe, it, expect } from 'vitest';
import {
  PUZZLE_FILTER_TYPES,
  PUZZLE_FILTER_DIFFICULTIES,
  defaultPuzzleFilterState,
  buildPuzzleKeyword,
  normalizeDifficulties,
  normalizePuzzleFilterState,
} from '../puzzleFilter';

describe('puzzleFilter', () => {
  it('题型选项非空且首项为布局', () => {
    expect(PUZZLE_FILTER_TYPES.length).toBeGreaterThan(0);
    expect(PUZZLE_FILTER_TYPES[0]!.value).toBe('布局');
  });

  it('难度选项覆盖 15K~1K 与 1D~7D', () => {
    expect(PUZZLE_FILTER_DIFFICULTIES[0]).toBe('15K');
    expect(PUZZLE_FILTER_DIFFICULTIES).toContain('1K');
    expect(PUZZLE_FILTER_DIFFICULTIES).toContain('1D');
    expect(PUZZLE_FILTER_DIFFICULTIES[PUZZLE_FILTER_DIFFICULTIES.length - 1]).toBe('7D');
    // 15K..1K 共 15 个 + 1D..7D 共 7 个
    expect(PUZZLE_FILTER_DIFFICULTIES.length).toBe(22);
  });

  it('不含 15K 以下的难度（内置题库无此区间题目）', () => {
    expect(PUZZLE_FILTER_DIFFICULTIES).not.toContain('16K');
    expect(PUZZLE_FILTER_DIFFICULTIES).not.toContain('20K');
    expect(PUZZLE_FILTER_DIFFICULTIES).not.toContain('30K');
  });

  it('默认筛选状态为首项题型、无难度', () => {
    const st = defaultPuzzleFilterState();
    expect(st.types).toEqual(['布局']);
    expect(st.difficulties).toEqual([]);
  });

  it('单题型 + 难度生成 and 表达式', () => {
    expect(buildPuzzleKeyword(['死活'], ['2D'])).toBe('死活 and 2D');
  });

  it('多题型生成 or 括号表达式', () => {
    expect(buildPuzzleKeyword(['官子', '死活'], ['2D'])).toBe('(官子 or 死活) and 2D');
  });

  it('无难度时只含题型', () => {
    expect(buildPuzzleKeyword(['死活'], [])).toBe('死活');
  });

  it('空题型 + 有难度时只含难度', () => {
    expect(buildPuzzleKeyword([], ['5D'])).toBe('5D');
  });

  it('全空时返回空串（不筛选）', () => {
    expect(buildPuzzleKeyword([], [])).toBe('');
  });

  // ===== 难度复选 =====
  it('多难度生成 or 括号表达式', () => {
    expect(buildPuzzleKeyword(['死活'], ['3D', '4D'])).toBe('死活 and (3D or 4D)');
    expect(buildPuzzleKeyword([], ['1K', '1D'])).toBe('(1K or 1D)');
  });

  it('题型与难度同时多选', () => {
    expect(buildPuzzleKeyword(['死活', '官子'], ['2D', '3D'])).toBe('(死活 or 官子) and (2D or 3D)');
  });

  it('单元素难度数组不加括号（与旧版单选输出一致）', () => {
    expect(buildPuzzleKeyword(['死活'], ['3D'])).toBe('死活 and 3D');
  });

  it('兼容旧版单值难度字符串入参', () => {
    expect(buildPuzzleKeyword(['死活'], '3D')).toBe('死活 and 3D');
    expect(buildPuzzleKeyword(['死活'], '')).toBe('死活');
  });

  it('normalizeDifficulties：过滤空值、兼容单值字符串', () => {
    expect(normalizeDifficulties(['3D', ''])).toEqual(['3D']);
    expect(normalizeDifficulties('3D')).toEqual(['3D']);
    expect(normalizeDifficulties('')).toEqual([]);
    expect(normalizeDifficulties(undefined)).toEqual([]);
    expect(normalizeDifficulties(null)).toEqual([]);
  });

  it('normalizePuzzleFilterState：旧版单值 difficulty 自动迁移为数组', () => {
    expect(normalizePuzzleFilterState({ types: ['死活'], difficulty: '3D' }))
      .toEqual({ types: ['死活'], difficulties: ['3D'] });
    expect(normalizePuzzleFilterState({ types: ['死活'], difficulty: '' }))
      .toEqual({ types: ['死活'], difficulties: [] });
  });

  it('normalizePuzzleFilterState：新版 difficulties 优先，剔除未知题型', () => {
    expect(normalizePuzzleFilterState({ types: ['死活', '瞎写'], difficulties: ['3D', '4D'], difficulty: '5D' }))
      .toEqual({ types: ['死活'], difficulties: ['3D', '4D'] });
  });

  it('normalizePuzzleFilterState：脏数据回落空结构', () => {
    expect(normalizePuzzleFilterState(null)).toEqual({ types: [], difficulties: [] });
    expect(normalizePuzzleFilterState('bad')).toEqual({ types: [], difficulties: [] });
    expect(normalizePuzzleFilterState({ types: '死活' })).toEqual({ types: [], difficulties: [] });
  });
});
