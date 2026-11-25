/**
 * Token 统计聚合（纯函数，不碰存储 / DOM / 时钟注入之外的任何东西）
 * @module application/token/TokenUsageStats
 *
 * 全部口径：
 * - 自然日按**设备本地时间**（与聊天时间戳同一口径），日期串 YYYY-MM-DD 字典序
 *   即时间序，无需时区换算。
 * - 「最近 7 天」= 今日 + 前 6 天；「最近 30 天」= 今日 + 前 29 天，含今日。
 * - 趋势缺天补 0，保证柱数固定、可比对。
 * - 分组按 totalTokens 降序（业务展示口径：谁烧得多谁在前），同值按 key 稳定排序。
 * - 不做任何估算 / 插值 / 平滑；未上报用量的请求计入 requests 与 unreported，
 *   token 贡献 0，面板单列说明。
 */

import type {
  TokenDayPoint, TokenGroupRow, TokenRangeId, TokenStats, TokenUsageRecord,
} from './TokenUsageTypes';

/** 本地自然日串（YYYY-MM-DD）。独立于 toISOString，避免 UTC 偏移错一天。 */
export function localDateKey(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 某天零点（本地）的毫秒时间戳；用于日期串 ±N 天与日内偏移换算 */
export function dayStartTs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).getTime();
}

/** date 往前推 days 天后的日期串（本地自然日，跨月/跨年/夏令时由 Date 处理） */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  // 用「日 + days」构造而不是加 86400000 毫秒：夏令时切换日不是 24 小时，
  // 毫秒加法会跳日或重复日。
  return localDateKey(new Date(y!, (m ?? 1) - 1, (d ?? 1) + days).getTime());
}

/** 时间段 → [起, 止] 自然日（含）。now 由调用方传入，便于单测固定时间 */
export function rangeBounds(range: TokenRangeId, now: number): { fromDate: string; toDate: string } {
  const today = localDateKey(now);
  switch (range) {
    case 'today':
      return { fromDate: today, toDate: today };
    case 'yesterday': {
      const y = shiftDate(today, -1);
      return { fromDate: y, toDate: y };
    }
    case 'last7':
      return { fromDate: shiftDate(today, -6), toDate: today };
    case 'last30':
      return { fromDate: shiftDate(today, -29), toDate: today };
    default: {
      // 穷尽性兜底：联合类型已列全，未知值按今日处理，绝不让函数无返回
      const exhaustive: never = range;
      void exhaustive;
      return { fromDate: today, toDate: today };
    }
  }
}

function emptyRow(key: string): TokenGroupRow {
  return {
    key, requests: 0, unreported: 0,
    promptTokens: 0, completionTokens: 0, totalTokens: 0,
  };
}

function addRecord(row: TokenGroupRow, r: TokenUsageRecord): void {
  row.requests += 1;
  if (!r.reported) row.unreported += 1;
  row.promptTokens += r.promptTokens;
  row.completionTokens += r.completionTokens;
  row.totalTokens += r.totalTokens;
}

function sortedRows(map: Map<string, TokenGroupRow>): TokenGroupRow[] {
  return [...map.values()].sort((a, b) =>
    b.totalTokens - a.totalTokens || a.key.localeCompare(b.key));
}

/** 模型分组 key：provider 与 model 用 \u0000 分隔，避免字符串拼接歧义 */
export const MODEL_KEY_SEP = '\u0000';

export function computeTokenStats(
  records: readonly TokenUsageRecord[],
  range: TokenRangeId,
  now: number,
): TokenStats {
  const { fromDate, toDate } = rangeBounds(range, now);
  const filtered = records.filter((r) => {
    const date = localDateKey(r.ts);
    return date >= fromDate && date <= toDate;
  });

  const total = emptyRow('total');
  const providers = new Map<string, TokenGroupRow>();
  const models = new Map<string, TokenGroupRow>();
  const tasks = new Map<string, TokenGroupRow>();
  const days = new Map<string, TokenDayPoint>();

  // 先把窗口内每一天补成 0 柱，再累加，保证趋势连续
  for (let date = fromDate; date <= toDate; date = shiftDate(date, 1)) {
    days.set(date, {
      date, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0,
    });
  }

  for (const r of filtered) {
    addRecord(total, r);
    const pKey = r.provider;
    if (!providers.has(pKey)) providers.set(pKey, emptyRow(pKey));
    addRecord(providers.get(pKey)!, r);

    const mKey = `${r.provider}${MODEL_KEY_SEP}${r.model}`;
    if (!models.has(mKey)) models.set(mKey, emptyRow(mKey));
    addRecord(models.get(mKey)!, r);

    const tKey = r.task;
    if (!tasks.has(tKey)) tasks.set(tKey, emptyRow(tKey));
    addRecord(tasks.get(tKey)!, r);

    const date = localDateKey(r.ts);
    const point = days.get(date)!;
    point.requests += 1;
    point.promptTokens += r.promptTokens;
    point.completionTokens += r.completionTokens;
    point.totalTokens += r.totalTokens;
  }

  return {
    range, fromDate, toDate,
    total,
    byProvider: sortedRows(providers),
    byModel: sortedRows(models),
    byTask: sortedRows(tasks),
    trend: [...days.values()],
  };
}

/** 数字千分位（纯展示，不参与计算；避免面板里引入格式化库） */
export function formatTokenCount(n: number): string {
  return n.toLocaleString('zh-CN');
}

/** 字节数展示：1024 进制，保留一位小数（仅用于「存储占用」实测值） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
