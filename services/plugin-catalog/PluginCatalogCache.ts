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
import type { CatalogEntry } from './PluginCatalogTypes';

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
  remoteCode?: string;
  intent?: string;
  origin?: 'llm' | 'manual';
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
      return raw.filter(isStaticEntry);
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
  if (entry.remoteCode !== undefined) s.remoteCode = entry.remoteCode;
  if (entry.intent !== undefined) s.intent = entry.intent;
  if (entry.origin !== undefined) s.origin = entry.origin;
  return s;
}

function isStaticEntry(v: unknown): v is StaticCatalogEntry {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o['registryUrl'] === 'string'
    && typeof o['resourceId'] === 'string'
    && typeof o['name'] === 'string'
    && typeof o['summary'] === 'string'
    && (o['kind'] === 'plugin' || o['kind'] === 'tool');
}
