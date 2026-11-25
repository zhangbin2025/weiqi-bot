/**
 * Token 统计聚合（纯函数，不碰存储 / DOM / 时钟注入之外的任何东西）
 * @module application/token/TokenUsageStats
 *
 * 全部口径：
 * - 自然日按**设备本地时间**（与聊天时间戳同一口径），日期串 YYYY-MM-DD 字典序
 *   即时间序，无需时区换算。
 * - 「最近 7 天」= 今日 + 前 6 天；「最近 30 天」= 今日 + 前 29 天，含今日。
 * - 今日 / 昨日趋势按**小时**分桶（一天 24 桶，24 是自然日小时数）；
 *   最近 7 / 30 天按天分桶。缺桶补 0，保证柱数固定、可比对。
 * - 分组按 totalTokens 降序（业务展示口径：谁烧得多谁在前），同值按 key 稳定排序。
 * - 不做任何估算 / 插值 / 平滑；未上报用量的请求计入 requests 与 unreported，
 *   token 贡献 0，面板单列说明。
 * - consistent：Σ byTask.totalTokens === total.totalTokens 的恒等式自检。两者在
 *   同一循环累加，正常恒为 true；false 只可能是坏分片/旧数据，供面板提示「以总消耗为准」。
 */

import type {
  TokenTrendPoint, TokenGroupRow, TokenRangeId, TokenStats, TokenUsageRecord,
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

/** 今日 / 昨日按小时，其余按天 */
export function isHourlyRange(range: TokenRangeId): boolean {
  return range === 'today' || range === 'yesterday';
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

/** 生成空趋势桶（含补零）。hourly 时单日 24 桶；否则 fromDate..toDate 每天一桶。 */
function emptyTrend(fromDate: string, toDate: string, hourly: boolean): TokenTrendPoint[] {
  const points: TokenTrendPoint[] = [];
  if (hourly) {
    // 今日 / 昨日都只涉及一个自然日，整整 24 小时全画出来（昨日不截断到当前时刻）。
    const pad2 = (n: number) => String(n).padStart(2, '0');
    for (let h = 0; h < 24; h += 1) {
      points.push({
        key: `${fromDate}T${pad2(h)}`, date: fromDate, label: pad2(h), bucketHour: h,
        requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0,
      });
    }
  } else {
    for (let date = fromDate; date <= toDate; date = shiftDate(date, 1)) {
      points.push({
        // 固定宽度弹窗里 30 根柱并排，柱下只标「日」（DD）；完整日期在
        // 趋势标题的起止范围与各柱 tooltip 里给全，避免 label 互相挤压。
        key: date, date, label: date.slice(8), bucketHour: null,
        requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0,
      });
    }
  }
  return points;
}

export function computeTokenStats(
  records: readonly TokenUsageRecord[],
  range: TokenRangeId,
  now: number,
): TokenStats {
  const { fromDate, toDate } = rangeBounds(range, now);
  const hourly = isHourlyRange(range);
  const filtered = records.filter((r) => {
    const date = localDateKey(r.ts);
    return date >= fromDate && date <= toDate;
  });

  const total = emptyRow('total');
  const providers = new Map<string, TokenGroupRow>();
  const models = new Map<string, TokenGroupRow>();
  const tasks = new Map<string, TokenGroupRow>();
  const trend = emptyTrend(fromDate, toDate, hourly);
  const trendIndex = new Map(trend.map((p, i) => [p.key, i]));

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
    const key = hourly
      ? `${date}T${String(new Date(r.ts).getHours()).padStart(2, '0')}`
      : date;
    const idx = trendIndex.get(key);
    const point = idx === undefined ? undefined : trend[idx];
    if (point) {
      point.requests += 1;
      point.promptTokens += r.promptTokens;
      point.completionTokens += r.completionTokens;
      point.totalTokens += r.totalTokens;
    }
  }

  const byTask = sortedRows(tasks);
  // 同一批记录、同一循环累加，理论上恒等；显式校验坏分片/旧数据。
  const taskSum = byTask.reduce((s, r) => s + r.totalTokens, 0);
  return {
    range, fromDate, toDate, hourly,
    total,
    byProvider: sortedRows(providers),
    byModel: sortedRows(models),
    byTask,
    trend,
    consistent: taskSum === total.totalTokens,
  };
}

/**
 * 精确值（千分位）：用于 tooltip / 副行，避免 K/M 缩写舍入造成「分项相加 ≠ 总数」的错觉。
 * 不参与任何计算。
 */
export function exactTokenCount(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

/**
 * 紧凑单位展示：K=10^3、M=10^6（SI 词头，token 是十进制计数，不是 1024 字节）。
 * <1000 显示原整数；≥1000 保留最多 2 位小数并去掉尾随 0。
 * 单位换算只为易读；精确值一律由 exactTokenCount 提供，别拿缩写值做加法比较。
 */
export function formatTokenCount(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1_000) return exactTokenCount(n);
  const compact = (v: number, suffix: string): string => {
    const s = v.toFixed(2).replace(/\.?0+$/, '');
    return `${s}${suffix}`;
  };
  if (abs < 1_000_000) return compact(n / 1_000, 'K');
  return compact(n / 1_000_000, 'M');
}

/**
 * 把「端点上报的任意值」归一成有限非负整数 token 计数。
 * 出处：token 计数按定义是非负整数；端点若给负数 / NaN / 字符串 / Infinity，
 * 一律记为 0（不是估算、不是补齐，只是拒绝非法值），避免脏值把合计与分项搅乱。
 */
export function normalizeTokenValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

/** 字节数展示：1024 进制，保留一位小数（仅用于「存储占用」实测值） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
