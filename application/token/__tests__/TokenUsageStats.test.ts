import { describe, it, expect } from 'vitest';
import {
  localDateKey, shiftDate, rangeBounds, computeTokenStats, MODEL_KEY_SEP,
} from '../TokenUsageStats';
import { normalizeRetentionDays } from '../TokenUsageTypes';
import type { TokenUsageRecord } from '../TokenUsageTypes';

/** 固定为本地 2026-11-25 15:00，避开 UTC/夏令时口径争议 */
const NOW = new Date(2026, 10, 25, 15, 0, 0).getTime();

function rec(ts: number, overrides: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    ts,
    provider: 'api.a.com',
    endpoint: 'https://api.a.com/v1/chat/completions',
    model: 'model-1',
    task: 'chat.reply',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    reported: true,
    ...overrides,
  };
}

const at = (day: number, hour = 10) => new Date(2026, 10, day, hour).getTime();

describe('日期口径', () => {
  it('localDateKey 用本地年月日，不用 UTC', () => {
    expect(localDateKey(at(25))).toBe('2026-11-25');
  });

  it('shiftDate 跨月/跨年正确', () => {
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('rangeBounds 含今日，最近 7 / 30 天 = 今日 + 前 6 / 29 天', () => {
    expect(rangeBounds('today', NOW)).toEqual({ fromDate: '2026-11-25', toDate: '2026-11-25' });
    expect(rangeBounds('yesterday', NOW)).toEqual({ fromDate: '2026-11-24', toDate: '2026-11-24' });
    expect(rangeBounds('last7', NOW)).toEqual({ fromDate: '2026-11-19', toDate: '2026-11-25' });
    expect(rangeBounds('last30', NOW)).toEqual({ fromDate: '2026-10-27', toDate: '2026-11-25' });
  });
});

describe('computeTokenStats', () => {
  const records = [
    rec(at(25, 9)),                                              // 今日 a/model-1
    rec(at(25, 11), { provider: 'api.b.com', model: 'model-2', promptTokens: 20, completionTokens: 10, totalTokens: 30 }),
    rec(at(24, 9)),                                              // 昨日 a/model-1
    rec(at(22, 9)),                                              // 最近 7 天内
    rec(at(1, 9)),                                               // 最近 30 天内、7 天外
    rec(new Date(2026, 9, 20, 9).getTime()),                       // 30 天窗口外
    rec(at(25, 12), { reported: false, promptTokens: 0, completionTokens: 0, totalTokens: 0 }), // 未上报
  ];

  it('today 只算今日，未上报计入 requests 但 token 为 0', () => {
    const s = computeTokenStats(records, 'today', NOW);
    expect(s.total.requests).toBe(3);
    expect(s.total.unreported).toBe(1);
    expect(s.total.promptTokens).toBe(120);
    expect(s.total.completionTokens).toBe(60);
    expect(s.total.totalTokens).toBe(180);
    expect(s.trend).toHaveLength(1);
  });

  it('byProvider / byModel 分维度统计正确', () => {
    const s = computeTokenStats(records, 'today', NOW);
    expect(s.byProvider.map((r) => r.key).sort()).toEqual(['api.a.com', 'api.b.com']);
    const a = s.byProvider.find((r) => r.key === 'api.a.com')!;
    expect(a.totalTokens).toBe(150);
    const modelKeys = s.byModel.map((r) => r.key);
    expect(modelKeys).toContain(`api.b.com${MODEL_KEY_SEP}model-2`);
  });

  it('byTask 分组保留用途标签', () => {
    const withTask = [...records, rec(at(25, 13), { task: 'chat.compact', totalTokens: 7, promptTokens: 5, completionTokens: 2 })];
    const s = computeTokenStats(withTask, 'today', NOW);
    expect(s.byTask.map((r) => r.key)).toContain('chat.compact');
  });

  it('last7 趋势固定 7 根柱，缺天补 0', () => {
    const s = computeTokenStats(records, 'last7', NOW);
    expect(s.trend).toHaveLength(7);
    expect(s.trend[0]!.date).toBe('2026-11-19');
    expect(s.trend[0]!.totalTokens).toBe(0);
    expect(s.trend.find((d) => d.date === '2026-11-25')!.requests).toBe(3);
  });

  it('last30 覆盖 10-27 起的记录，并排除 10-20 那条', () => {
    const s = computeTokenStats(records, 'last30', NOW);
    expect(s.trend).toHaveLength(30);
    // 共 7 条，10-20 一条在窗口外 → 6 条计入
    expect(s.total.requests).toBe(6);
    expect(s.trend[0]!.date).toBe('2026-10-27');
  });
});

describe('normalizeRetentionDays', () => {
  it('非法值回落 30，越界收敛 1~365', () => {
    expect(normalizeRetentionDays('abc')).toBe(30);
    expect(normalizeRetentionDays(0)).toBe(1);
    expect(normalizeRetentionDays(9999)).toBe(365);
    expect(normalizeRetentionDays(7.6)).toBe(8);
  });
});
