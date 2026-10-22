/**
 * 做题历史「已做 URL 集合」测试
 * @description 验证 getDoneUrls 的口径（出题「未做优先」分层的依据）：
 *   - 不论对错，只要历史里有记录就算已做（错题也让位给新题）
 *   - 只认内置题库 URL，在线题不参与
 *   - 按 URL 去重
 */
import { describe, it, expect, vi } from 'vitest';
import { PuzzleHistoryManager } from '../PuzzleHistoryManager';
import type { IActivityLogService, ActivityEntry } from '../../../services/activity';

function entry(url: string, success = true, id?: string): ActivityEntry {
  return {
    id: id ?? `e_${url}`,
    type: 'puzzle',
    title: `做题：#${url}`,
    data: { url, tag: '死活题·5D', success, attempts: 1, duration: 1000 },
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

const LIB = 'lib://life-and-death/2026-10-20/';
const ONLINE = 'https://101weiqi.com/p/';

describe('PuzzleHistoryManager.getDoneUrls', () => {
  it('无历史服务时返回空集合', async () => {
    const m = new PuzzleHistoryManager();
    expect(await m.getDoneUrls()).toEqual(new Set());
  });

  it('返回已做的内置题库题 URL', async () => {
    const m = new PuzzleHistoryManager(makeLog([entry(LIB + '0'), entry(LIB + '7')]));
    const done = await m.getDoneUrls();
    expect(done.has(LIB + '0')).toBe(true);
    expect(done.has(LIB + '7')).toBe(true);
    expect(done.has(LIB + '3')).toBe(false);
    expect(done.size).toBe(2);
  });

  it('不论对错都算已做（错题也让位给新题）', async () => {
    const m = new PuzzleHistoryManager(makeLog([
      entry(LIB + '0', true),
      entry(LIB + '1', false),
    ]));
    const done = await m.getDoneUrls();
    expect(done.has(LIB + '0')).toBe(true);
    expect(done.has(LIB + '1')).toBe(true);
  });

  it('在线来源的题不计入（无稳定题号，不参与未做优先排序）', async () => {
    const m = new PuzzleHistoryManager(makeLog([
      entry(ONLINE + '123'),
      entry(LIB + '0'),
    ]));
    const done = await m.getDoneUrls();
    expect(done.has(ONLINE + '123')).toBe(false);
    expect(done.has(LIB + '0')).toBe(true);
  });

  it('同一题重复记录只出现一次（Set 去重）', async () => {
    const m = new PuzzleHistoryManager(makeLog([
      entry(LIB + '0', true, 'a1'),
      entry(LIB + '0', false, 'a2'),
      entry(LIB + '0', true, 'a3'),
    ]));
    expect((await m.getDoneUrls()).size).toBe(1);
  });

  it('空历史返回空集合', async () => {
    const m = new PuzzleHistoryManager(makeLog([]));
    expect((await m.getDoneUrls()).size).toBe(0);
  });

  it('与其它题库分类（ai-review）的 URL 不混淆', async () => {
    const m = new PuzzleHistoryManager(makeLog([
      entry('lib://ai-review/2026-10-20/0'),
    ]));
    expect((await m.getDoneUrls()).size).toBe(0);
  });
});
