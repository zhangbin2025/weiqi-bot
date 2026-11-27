/**
 * 在线插件列表的离线兜底缓存
 * @module services/plugin-catalog/PluginCatalogCache
 *
 * 只缓存「资源元数据」（名称/说明/源码全文等静态字段），不缓存安装状态：
 * 每个源不可达时把上次的静态条目回放出来，再按当前本地工件重新计算
 * new/installed/update，避免展示过期状态。源码已随缓存保留，离线也能安装。
 *
 * 源码是纯文本；缓存体积上限由 localStorage 自身决定，不做人为截断阈值。
 * 存储不可用时全部静默降级（缓存是可有可无的增强，不是主链路）。
 */

import { LocalStorageAdapter } from '@infrastructure/storage/adapters/web/LocalStorageAdapter';
import type { CatalogEntry, OperatorExposure, OperatorSmokeCase } from './PluginCatalogTypes';

const CACHE_KEY = 'plugin-catalog:cache';

/** 只保留与本地状态无关的静态字段 */
export interface StaticCatalogEntry {
  registryUrl: string;
  official: boolean;
  resourceId: string;
  kind: 'plugin' | 'tool';
  name: string;
  summary: string;
  pointId?: string;
  specVersion?: number;
  category?: string;
  remoteCode?: string;
  intent?: string;
  origin?: 'llm' | 'manual';
  exposes?: OperatorExposure[];
  smoke?: OperatorSmokeCase[];
}

export interface PluginCatalogCacheDeps {
  localStorage?: LocalStorageAdapter;
}

export class PluginCatalogCache {
  private readonly store: LocalStorageAdapter;

  constructor(deps: PluginCatalogCacheDeps = {}) {
    this.store = deps.localStorage ?? new LocalStorageAdapter('weiqi-bot');
  }

  /** 按源保存本次成功解析出的静态条目（整份覆盖，键是 registryUrl） */
  async save(registryUrl: string, entries: CatalogEntry[]): Promise<void> {
    try {
      await this.store.initialize();
      const all = await this.readAll();
      all[registryUrl] = entries.map(toStatic);
      await this.store.write(CACHE_KEY, all);
    } catch {
      // 缓存写失败不影响在线浏览
    }
  }

  /** 源不可达时读取；没有/损坏返回空数组 */
  async load(registryUrl: string): Promise<StaticCatalogEntry[]> {
    try {
      await this.store.initialize();
      const all = await this.readAll();
      const raw = all[registryUrl];
      if (!Array.isArray(raw)) return [];
      return raw.filter((entry): entry is StaticCatalogEntry =>
        isStaticEntry(entry) && entry.registryUrl === registryUrl,
      );
    } catch {
      return [];
    }
  }

  private async readAll(): Promise<Record<string, unknown>> {
    const raw = await this.store.read<unknown>(CACHE_KEY);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    return raw as Record<string, unknown>;
  }
}

function toStatic(entry: CatalogEntry): StaticCatalogEntry {
  const s: StaticCatalogEntry = {
    registryUrl: entry.registryUrl,
    official: entry.official,
    resourceId: entry.resourceId,
    kind: entry.kind,
    name: entry.name,
    summary: entry.summary,
  };
  if (entry.pointId !== undefined) s.pointId = entry.pointId;
  if (entry.specVersion !== undefined) s.specVersion = entry.specVersion;
  if (entry.category !== undefined) s.category = entry.category;
  if (entry.remoteCode !== undefined) s.remoteCode = entry.remoteCode;
  if (entry.intent !== undefined) s.intent = entry.intent;
  if (entry.origin !== undefined) s.origin = entry.origin;
  if (entry.exposes !== undefined) s.exposes = entry.exposes;
  if (entry.smoke !== undefined) s.smoke = entry.smoke;
  return s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStaticEntry(v: unknown): v is StaticCatalogEntry {
  if (!isRecord(v)) return false;
  if (typeof v['registryUrl'] !== 'string'
    || typeof v['official'] !== 'boolean'
    || typeof v['resourceId'] !== 'string'
    || !v['resourceId']
    || typeof v['name'] !== 'string'
    || typeof v['summary'] !== 'string'
    || (v['kind'] !== 'plugin' && v['kind'] !== 'tool')) return false;

  if (v['pointId'] !== undefined && typeof v['pointId'] !== 'string') return false;
  if (v['specVersion'] !== undefined
    && (!Number.isInteger(v['specVersion']) || (v['specVersion'] as number) < 1)) return false;
  if (v['category'] !== undefined && typeof v['category'] !== 'string') return false;
  if (v['remoteCode'] !== undefined && typeof v['remoteCode'] !== 'string') return false;
  if (v['intent'] !== undefined && typeof v['intent'] !== 'string') return false;
  if (v['origin'] !== undefined && v['origin'] !== 'llm' && v['origin'] !== 'manual') return false;

  if (v['exposes'] !== undefined) {
    if (!Array.isArray(v['exposes'])) return false;
    for (const expose of v['exposes']) {
      if (!isRecord(expose)
        || typeof expose['name'] !== 'string'
        || typeof expose['description'] !== 'string'
        || !isRecord(expose['inputSchema'])
        || !isRecord(expose['outputSchema'])
        || (expose['kind'] !== 'pure' && expose['kind'] !== 'io' && expose['kind'] !== 'effect')
        || typeof expose['idempotent'] !== 'boolean') return false;
    }
  }
  if (v['smoke'] !== undefined) {
    if (!Array.isArray(v['smoke'])) return false;
    for (const sample of v['smoke']) {
      if (!isRecord(sample)
        || (sample['method'] !== undefined && typeof sample['method'] !== 'string')
        || !Array.isArray(sample['args'])
        || !Object.prototype.hasOwnProperty.call(sample, 'expect')) return false;
    }
  }
  return true;
}
