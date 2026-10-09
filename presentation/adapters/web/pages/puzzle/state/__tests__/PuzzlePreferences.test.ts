/**
 * 做题偏好持久化测试（来源 + 筛选条件）
 * @description 用户真实场景：内置题库筛选题型死活 + 难度 3D → 切到在线 101 → 刷新
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PuzzlePreferences, resolvePuzzleKeyword } from '../PuzzlePreferences';
import type { PuzzleSource } from '../../../../../../../application/puzzle/PuzzleApp';

const LIB: PuzzleSource = 'lib-life-death';
const ONLINE: PuzzleSource = 'weiqi101';
const STORED_FILTER = { types: ['死活', '官子'], difficulty: '3D' };
const EXPECT_KEYWORD = '(死活 or 官子) and 3D';

describe('PuzzlePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('默认：内置题库 + 无筛选条件', async () => {
    const prefs = new PuzzlePreferences();
    await prefs.load();
    expect(prefs.getSource()).toBe(LIB);
    expect(prefs.getFilter()).toBeNull();
    expect(prefs.resolveKeyword()).toBe('');
  });

  it('来源/筛选写入后能持久化', async () => {
    const prefs = new PuzzlePreferences();
    await prefs.load();
    prefs.setSource(ONLINE);
    prefs.setFilter(STORED_FILTER);
    expect(prefs.resolveKeyword()).toBe('');

    const reloaded = new PuzzlePreferences();
    await reloaded.load();
    expect(reloaded.getSource()).toBe(ONLINE);
    expect(reloaded.getFilter()).toEqual(STORED_FILTER);
    expect(reloaded.resolveKeyword()).toBe('');
    expect(reloaded.resolveKeyword(LIB)).toBe(EXPECT_KEYWORD);
  });

  it('刷新恢复：在线来源不筛选，切回内置题库恢复上一次条件', async () => {
    const before = new PuzzlePreferences();
    await before.load();
    before.setSource(LIB);
    before.setFilter(STORED_FILTER);
    before.setSource(ONLINE);

    const after = new PuzzlePreferences();
    await after.load();
    expect(after.getSource()).toBe(ONLINE);
    expect(after.resolveKeyword()).toBe('');
    expect(after.getFilter()).toEqual(STORED_FILTER);
    expect(after.resolveKeyword(LIB)).toBe(EXPECT_KEYWORD);

    after.setSource(LIB);
    expect(after.resolveKeyword()).toBe(EXPECT_KEYWORD);

    const third = new PuzzlePreferences();
    await third.load();
    expect(third.getSource()).toBe(LIB);
    expect(third.resolveKeyword()).toBe(EXPECT_KEYWORD);
  });

  it('全新本地：预置在线来源 + 筛选条件，在线不筛选、切回内置题库生效', async () => {
    localStorage.setItem('weiqi-bot:puzzle_source', JSON.stringify(ONLINE));
    localStorage.setItem('weiqi-bot:puzzle_filter_state', JSON.stringify(STORED_FILTER));

    const prefs = new PuzzlePreferences();
    await prefs.load();
    expect(prefs.getSource()).toBe(ONLINE);
    expect(prefs.resolveKeyword()).toBe('');
    expect(prefs.resolveKeyword(LIB)).toBe(EXPECT_KEYWORD);

    prefs.setSource(LIB);
    expect(prefs.resolveKeyword()).toBe(EXPECT_KEYWORD);
  });

  it('筛选条件为空（用户未设条件）时不出筛选题', async () => {
    const prefs = new PuzzlePreferences();
    await prefs.load();
    prefs.setFilter({ types: [], difficulty: '' });
    expect(prefs.resolveKeyword()).toBe('');

    const reloaded = new PuzzlePreferences();
    await reloaded.load();
    expect(reloaded.getFilter()).toEqual({ types: [], difficulty: '' });
    expect(reloaded.resolveKeyword()).toBe('');
  });

  it('从未设置筛选条件（null）时不出筛选题', async () => {
    const prefs = new PuzzlePreferences();
    await prefs.load();
    expect(prefs.getFilter()).toBeNull();
    expect(prefs.resolveKeyword(LIB)).toBe('');
  });

  it('脏数据：筛选条件不是对象（JSON 解析失败返回原始字符串）时回落 null', async () => {
    localStorage.setItem('weiqi-bot:puzzle_filter_state', '{bad json');
    const prefs = new PuzzlePreferences();
    await prefs.load();
    expect(prefs.getFilter()).toBeNull();
    expect(prefs.resolveKeyword(LIB)).toBe('');
  });

  it('脏数据：types 不是数组时回落空数组，不出题型筛选', async () => {
    localStorage.setItem('weiqi-bot:puzzle_filter_state', JSON.stringify({ types: '死活', difficulty: '3D' }));
    const prefs = new PuzzlePreferences();
    await prefs.load();
    expect(prefs.getFilter()).toEqual({ types: [], difficulty: '3D' });
    expect(prefs.resolveKeyword(LIB)).toBe('3D');
  });

  it('只设难度 / 只设题型都能生成关键字', async () => {
    const prefs = new PuzzlePreferences();
    await prefs.load();
    prefs.setFilter({ types: [], difficulty: '5D' });
    expect(prefs.resolveKeyword()).toBe('5D');
    prefs.setFilter({ types: ['布局'], difficulty: '' });
    expect(prefs.resolveKeyword()).toBe('布局');
  });

  it('非法来源不落盘、不改变当前来源', async () => {
    const prefs = new PuzzlePreferences();
    await prefs.load();
    prefs.setSource('unknown-source' as PuzzleSource);
    expect(prefs.getSource()).toBe(LIB);
    expect(localStorage.getItem('weiqi-bot:puzzle_source')).toBeNull();
  });

  it('兼容旧版键名 puzzle_puzzle_*', async () => {
    localStorage.setItem('weiqi-bot:puzzle_puzzle_source', JSON.stringify('goproblems'));
    const prefs = new PuzzlePreferences();
    await prefs.load();
    expect(prefs.getSource()).toBe('goproblems');
  });
});

describe('resolvePuzzleKeyword', () => {
  it('非内置题库一律不筛选', () => {
    expect(resolvePuzzleKeyword(ONLINE, STORED_FILTER)).toBe('');
    expect(resolvePuzzleKeyword('goproblems', STORED_FILTER)).toBe('');
    expect(resolvePuzzleKeyword('ogs-puzzle', STORED_FILTER)).toBe('');
  });

  it('内置题库按条件生成关键字', () => {
    expect(resolvePuzzleKeyword(LIB, STORED_FILTER)).toBe(EXPECT_KEYWORD);
    expect(resolvePuzzleKeyword(LIB, { types: ['死活'], difficulty: '' })).toBe('死活');
  });

  it('条件为空或 null 时不筛选', () => {
    expect(resolvePuzzleKeyword(LIB, { types: [], difficulty: '' })).toBe('');
    expect(resolvePuzzleKeyword(LIB, null)).toBe('');
  });
});
