import { describe, it, expect, beforeEach } from 'vitest';
import pako from 'pako';
import {
  encodeDaily, decodeDaily, TokenUsageStore,
} from '../TokenUsageStore';
import type { TokenUsageRecord } from '../../../application/token/TokenUsageTypes';
import { localDateKey } from '../../../application/token/TokenUsageStats';

/** fake-indexeddb/auto 由 vitest 环境注入；这里显式再引一次保证独立运行也生效 */
import 'fake-indexeddb/auto';

function rec(overrides: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    ts: new Date(2026, 10, 25, 12, 30, 0).getTime(),
    provider: 'api.example.com',
    endpoint: 'https://api.example.com/v1/chat/completions',
    model: 'model-a',
    task: 'chat.reply',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    reported: true,
    ...overrides,
  };
}

describe('encodeDaily / decodeDaily', () => {
  it('round-trip 保留全部字段，字典去重后字符串只存一次', () => {
    const date = localDateKey(rec().ts);
    const records = [rec(), rec({ task: 'chat.title', promptTokens: 10, completionTokens: 5, totalTokens: 15 })];
    const blob = encodeDaily(records, date);
    // 两条记录 + 重复字典，deflate 后应远小于原文 JSON
    const text = JSON.stringify(records);
    expect(blob.byteLength).toBeLessThan(text.length);
    const out = decodeDaily(blob, date);
    expect(out).toEqual(records);
  });

  it('未上报 usage 的记录 reported=false 且 token 为 0', () => {
    const date = localDateKey(rec().ts);
    const r = rec({ promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false });
    expect(decodeDaily(encodeDaily([r], date), date)).toEqual([r]);
  });

  it('坏 blob 解码抛错，由 store 层降级处理', () => {
    expect(() => decodeDaily(new Uint8Array([1, 2, 3]), '2026-11-25')).toThrow();
  });

  it('解码时把非法 token 数值归一成 0（旧分片/半写入分片不污染聚合）', () => {
    // 手工构造一个带脏值的紧凑分片（绕过 encodeDaily 的类型约束）
    const date = '2026-11-25';
    const dirty = {
      v: 1,
      d: { p: ['api.a.com'], e: ['https://api.a.com/v1'], m: ['m'], t: ['chat.reply'] },
      r: [[0, 0, 0, 0, 0, -5, NaN as unknown as number, 'oops' as unknown as number, 1]],
    };
    // JSON.stringify 会把 NaN 变 null、字符串保留；两种都要被归一化吃掉
    const blob = pako.deflate(JSON.stringify(dirty));
    const out = decodeDaily(blob, date);
    expect(out).toHaveLength(1);
    expect(out[0]!.promptTokens).toBe(0);
    expect(out[0]!.completionTokens).toBe(0);
    expect(out[0]!.totalTokens).toBe(0);
  });
});

describe('TokenUsageStore', () => {
  // 所有实例共用固定 DB 名，用例间先清空，避免相互污染
  beforeEach(async () => { await new TokenUsageStore().clear(); });

  it('append 同一天两条 → loadRange 全取回；跨天分片独立', async () => {
    const store = new TokenUsageStore();
    const a = rec();
    const b = rec({ ts: new Date(2026, 10, 25, 18, 0).getTime(), model: 'model-b' });
    const c = rec({ ts: new Date(2026, 10, 24, 9, 0).getTime() });
    await Promise.all([store.append(a), store.append(b), store.append(c)]);
    const out = await store.loadRange('2026-11-24', '2026-11-25');
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.model).sort()).toEqual(['model-a', 'model-a', 'model-b']);
  });

  it('prune 按保留天数删除过期整片', async () => {
    const store = new TokenUsageStore();
    const now = new Date(2026, 10, 25, 12, 0).getTime();
    const old = rec({ ts: new Date(2026, 9, 1, 12, 0).getTime() });
    const fresh = rec({ ts: now });
    await store.append(old);
    await store.append(fresh);
    // 保留 30 天：10-01 分片过期，11-25 保留
    await store.prune(30, now);
    const out = await store.loadRange('2026-01-01', '2026-12-31');
    expect(out).toHaveLength(1);
    expect(out[0]!.ts).toBe(fresh.ts);
  });

  it('storageBytes 等于各分片 blob 字节和，clear 后归零', async () => {
    const store = new TokenUsageStore();
    expect(await store.storageBytes()).toBe(0);
    await store.append(rec());
    expect(await store.storageBytes()).toBeGreaterThan(0);
    await store.clear();
    expect(await store.storageBytes()).toBe(0);
  });
});
