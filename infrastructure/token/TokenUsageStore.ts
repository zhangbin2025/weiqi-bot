/**
 * Token 用量压缩存储
 * @module infrastructure/token/TokenUsageStore
 *
 * 物理布局：IndexedDB 库 `weiqi-token-usage` / store `daily`，
 * keyPath='id'，主键即本地自然日 YYYY-MM-DD —— 一天一条记录。
 * 分片 blob = pako.deflate(紧凑 JSON 文本)，列式 + 字典编码：
 *
 *   { v:1, d:{p:[provider],e:[endpoint],m:[model],t:[task]},
 *     r:[[msOfDay, pIdx, eIdx, mIdx, tIdx, prompt, completion, total, reported?1:0], ...] }
 *
 * 压缩收益来自三处可复算的结构选择（不是拍脑袋的阈值）：
 * 1) 重复的 provider / endpoint / model / task 字符串每天只存一次（字典）；
 * 2) 时间存「日内毫秒偏移」而不是 13 位绝对时间戳；
 * 3) 每条记录是数组而非对象，字段名不重复出现。
 * 再交给 deflate 处理数字与重复模式。实测占用由 storageBytes() 直接汇报。
 *
 * 并发：模块级 Promise 队列串行化「读分片 → 追加 → 压缩 → put」，
 * 避免同一天分片被两次并发读改写互相覆盖（意图识别与对话可能并发返回）。
 * 写入失败一律静默降级：统计是旁路能力，绝不影响 LLM 请求。
 */

import pako from 'pako';
import { IndexedDBAdapter } from '../storage/adapters/web/IndexedDBAdapter';
import {
  DEFAULT_TOKEN_RETENTION_DAYS, type TokenUsageRecord,
} from '../../application/token/TokenUsageTypes';
import { localDateKey, dayStartTs, shiftDate } from '../../application/token/TokenUsageStats';

export const TOKEN_USAGE_DB = 'weiqi-token-usage';
export const TOKEN_USAGE_STORE = 'daily';

interface DailyDoc {
  /** 本地自然日 YYYY-MM-DD */
  id: string;
  /** pako.deflate 后的紧凑 JSON */
  blob: Uint8Array;
  /** 该分片的记录数（展示 / 快速核对，不参与聚合正确性） */
  count: number;
  /** 最后写入时刻 */
  updatedAt: number;
}

/** 分片内部的紧凑形状；仅本文件认识，外部只见 TokenUsageRecord */
interface CompactDaily {
  v: 1;
  d: { p: string[]; e: string[]; m: string[]; t: string[] };
  r: Array<[number, number, number, number, number, number, number, number, 0 | 1]>;
}

const VERSION = 1;

function emptyDaily(): CompactDaily {
  return { v: VERSION, d: { p: [], e: [], m: [], t: [] }, r: [] };
}

/** 字典追加（不存在才 push），返回下标 */
function intern(list: string[], value: string): number {
  const found = list.indexOf(value);
  if (found >= 0) return found;
  list.push(value);
  return list.length - 1;
}

export function encodeDaily(records: readonly TokenUsageRecord[], date: string): Uint8Array {
  const daily = emptyDaily();
  const start = dayStartTs(date);
  for (const r of records) {
    // 跨零点或调用方传入非本日记录时，偏移可能为负/超范围；按记录自身时间
    // 归档由调用方保证（append 按 localDateKey(r.ts) 分片），这里只做减法。
    daily.r.push([
      r.ts - start,
      intern(daily.d.p, r.provider),
      intern(daily.d.e, r.endpoint),
      intern(daily.d.m, r.model),
      intern(daily.d.t, r.task),
      r.promptTokens,
      r.completionTokens,
      r.totalTokens,
      r.reported ? (1 as const) : (0 as const),
    ]);
  }
  // 不指定 level：用 pako 库默认压缩级别（不引入无出处的人为常数）。
  return pako.deflate(JSON.stringify(daily));
}

export function decodeDaily(blob: Uint8Array, date: string): TokenUsageRecord[] {
  const text = pako.inflate(blob, { to: 'string' });
  const parsed = JSON.parse(text) as CompactDaily;
  if (parsed.v !== VERSION || !Array.isArray(parsed.r)
    || !parsed.d || !Array.isArray(parsed.d.p) || !Array.isArray(parsed.d.e)
    || !Array.isArray(parsed.d.m) || !Array.isArray(parsed.d.t)) return [];
  const start = dayStartTs(date);
  const out: TokenUsageRecord[] = [];
  for (const row of parsed.r) {
    if (!Array.isArray(row) || row.length < 9) continue;
    const [offset, p, e, m, t, prompt, completion, total, reported] = row;
    out.push({
      ts: start + (offset ?? 0),
      provider: parsed.d.p[p ?? -1] ?? 'unknown',
      endpoint: parsed.d.e[e ?? -1] ?? '',
      model: parsed.d.m[m ?? -1] ?? '',
      task: parsed.d.t[t ?? -1] ?? '',
      promptTokens: prompt ?? 0,
      completionTokens: completion ?? 0,
      totalTokens: total ?? 0,
      reported: reported === 1,
    });
  }
  return out;
}

export class TokenUsageStore {
  private readonly adapter = new IndexedDBAdapter<DailyDoc>(TOKEN_USAGE_DB, TOKEN_USAGE_STORE);
  private initPromise: Promise<void> | null = null;
  /** 串行化所有读改写，避免同一天分片并发追加丢记录 */
  private queue: Promise<unknown> = Promise.resolve();

  private ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.adapter.initialize().catch((error) => {
        this.initPromise = null;
        throw error;
      });
    }
    return this.initPromise;
  }

  /** 追加一条记录；任何失败静默吞掉（旁路语义） */
  append(record: TokenUsageRecord): Promise<void> {
    const run = async (): Promise<void> => {
      await this.ensureReady();
      const date = localDateKey(record.ts);
      const existing = await this.adapter.findById(date);
      // 坏分片 inflate 失败时 decodeDaily 会抛：宁可丢掉这一片的历史、只保留
      // 本次记录，也不把整天的写入永久卡死（统计是旁路，允许降级）。
      let base: TokenUsageRecord[] = [];
      if (existing) {
        try { base = decodeDaily(existing.blob, date); } catch { base = []; }
      }
      const all = [...base, record];
      const blob = encodeDaily(all, date);
      const doc: DailyDoc = { id: date, blob, count: all.length, updatedAt: Date.now() };
      if (existing) await this.adapter.update(date, doc);
      else await this.adapter.insert(doc);
    };
    const task = this.queue.then(run, run).catch(() => { /* 旁路：吞掉 */ });
    this.queue = task;
    return task;
  }

  /** 读取 [fromDate, toDate]（含）窗口内全部分片；坏分片跳过而不中断 */
  async loadRange(fromDate: string, toDate: string): Promise<TokenUsageRecord[]> {
    await this.ensureReady();
    const docs = await this.adapter.find();
    const out: TokenUsageRecord[] = [];
    for (const doc of docs) {
      if (doc.id < fromDate || doc.id > toDate) continue;
      try {
        out.push(...decodeDaily(doc.blob, doc.id));
      } catch { /* 单个坏分片不影响整体统计 */ }
    }
    return out;
  }

  /** 删除截止日之前的整片；retentionDays 缺省取业务默认值 */
  async prune(retentionDays: number = DEFAULT_TOKEN_RETENTION_DAYS, now: number = Date.now()): Promise<void> {
    await this.ensureReady();
    const cutoff = shiftDate(localDateKey(now), -(retentionDays - 1));
    const docs = await this.adapter.find();
    const stale = docs.filter((d) => d.id < cutoff).map((d) => d.id);
    if (stale.length > 0) await this.adapter.deleteMany(stale);
  }

  /** 清空全部统计（面板「清空」按钮） */
  async clear(): Promise<void> {
    await this.ensureReady();
    await this.adapter.clear();
  }

  /** 实测存储占用 = 各分片 blob 字节数之和；可复算，不写估算值 */
  async storageBytes(): Promise<number> {
    await this.ensureReady();
    const docs = await this.adapter.find();
    return docs.reduce((sum, d) => sum + (d.blob?.byteLength ?? 0), 0);
  }

  /** 查询窗口并顺手清理过期分片；清理失败不影响查询结果 */
  async loadRangeAndPrune(
    fromDate: string,
    toDate: string,
    retentionDays: number,
    now: number = Date.now(),
  ): Promise<TokenUsageRecord[]> {
    const records = await this.loadRange(fromDate, toDate);
    await this.prune(retentionDays, now).catch(() => { /* 清理失败不影响展示 */ });
    return records;
  }
}

/** 页面装配用的共享单例：所有请求侧观察者与面板读写同一实例 */
export const tokenUsageStore = new TokenUsageStore();
