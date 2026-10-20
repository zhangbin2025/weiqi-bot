/**
 * 做题历史「已做数」统计测试
 * @description 验证 countMatchingKeyword 的口径：
 *   内置题库题按筛选表达式计数、按 url 去重、在线题与非命中题不计入。
 */
import { describe, it, expect, vi } from 'vitest';
import { PuzzleHistoryManager } from '../PuzzleHistoryManager';
import type { IActivityLogService, ActivityEntry } from '../../../services/activity';

/** url → 活动记录 */
function entry(url: string, tag: string, id?: string): ActivityEntry {
  return {
    id: id ?? `e_${url}`,
    type: 'puzzle',
    title: `做题：#${url}`,
    data: { url, tag, success: true, attempts: 1, duration: 1000 },
    createdAt: Date.now(),
  };
}

function makeLog(entries: ActivityEntry[]) {
  return {
    query: vi.fn().mockResolvedValue(entries),
    record: vi.fn(),
    getById: vi.fn(),
    stats: vi.fn(),
    count: vi.fn(),
    clear: vi.fn(),
    initialize: vi.fn(),
  } as unknown as IActivityLogService;
}

const LIB = 'lib://life-and-death/2026-10-19/';
const ONLINE = 'https://101weiqi.com/p/';

describe('PuzzleHistoryManager.countMatchingKeyword', () => {
  it('无历史服务时返回 0', async () => {
    const m = new PuzzleHistoryManager();
    expect(await m.countMatchingKeyword('死活')).toBe(0);
  });

  it('不筛选时返回内置题库已做题总数', async () => {
    const log = makeLog([
      entry(LIB + '0', '死活题·5D'),
      entry(LIB + '1', '官子题·2D'),
    ]);
    const m = new PuzzleHistoryManager(log);
    expect(await m.countMatchingKeyword('')).toBe(2);
    expect(await m.countMatchingKeyword(undefined)).toBe(2);
  });

  it('按筛选表达式只计命中的题', async () => {
    const log = makeLog([
      entry(LIB + '0', '死活题·5D'),
      entry(LIB + '1', '官子题·2D'),
      entry(LIB + '2', '中盘题·2D'),
    ]);
    const m = new PuzzleHistoryManager(log);
    expect(await m.countMatchingKeyword('死活')).toBe(1);
    expect(await m.countMatchingKeyword('(死活 or 官子)')).toBe(2);
    expect(await m.countMatchingKeyword('死活 and 2D')).toBe(0);
    expect(await m.countMatchingKeyword('(官子 or 中盘) and 2D')).toBe(2);
  });

  it('同一题重复做只算一题（按 url 去重）', async () => {
    const log = makeLog([
      entry(LIB + '0', '死活题·5D', 'a1'),
      entry(LIB + '0', '死活题·5D', 'a2'),
      entry(LIB + '0', '死活题·5D', 'a3'),
      entry(LIB + '1', '死活题·5D', 'b1'),
    ]);
    const m = new PuzzleHistoryManager(log);
    expect(await m.countMatchingKeyword('死活')).toBe(2);
  });

  it('在线来源的题不计入（无「类型·难度」标签，无法判定筛选）', async () => {
    const log = makeLog([
      entry(ONLINE + '123', '死活题·5D'),
      entry(LIB + '0', '死活题·5D'),
    ]);
    const m = new PuzzleHistoryManager(log);
    // 即便 tag 长得像题库标签，url 不是内置协议也不参与
    expect(await m.countMatchingKeyword('死活')).toBe(1);
    expect(await m.countMatchingKeyword('')).toBe(1);
  });

  it('标签缺失的记录不属于任何筛选（保守不计入）', async () => {
    const log = makeLog([
      entry(LIB + '0', ''),
      entry(LIB + '1', '死活题·5D'),
    ]);
    const m = new PuzzleHistoryManager(log);
    expect(await m.countMatchingKeyword('死活')).toBe(1);
    // 但「不筛选」的口径是「已做的内置题」，与标签无关
    expect(await m.countMatchingKeyword('')).toBe(2);
  });

  it('难度边界：5K 不误命中 15K（与列表筛选口径一致）', async () => {
    const log = makeLog([
      entry(LIB + '0', '死活题·15K'),
      entry(LIB + '1', '死活题·5K'),
    ]);
    const m = new PuzzleHistoryManager(log);
    expect(await m.countMatchingKeyword('5K')).toBe(1);
    expect(await m.countMatchingKeyword('15K')).toBe(1);
  });

  it('难度 +：2D 命中 2D+，2D+ 不命中 2D', async () => {
    const log = makeLog([
      entry(LIB + '0', '官子题·2D+'),
      entry(LIB + '1', '官子题·2D'),
    ]);
    const m = new PuzzleHistoryManager(log);
    expect(await m.countMatchingKeyword('2D')).toBe(2);
    expect(await m.countMatchingKeyword('2D+')).toBe(1);
  });

  it('空历史返回 0', async () => {
    const m = new PuzzleHistoryManager(makeLog([]));
    expect(await m.countMatchingKeyword('死活')).toBe(0);
  });

  it('表达式首尾空格不影响判定', async () => {
    const log = makeLog([entry(LIB + '0', '死活题·5D')]);
    const m = new PuzzleHistoryManager(log);
    expect(await m.countMatchingKeyword('  死活  ')).toBe(1);
  });
});
