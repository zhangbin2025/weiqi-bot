/**
 * 插件工件存储（浏览器 IndexedDB 实现）
 * @module infrastructure/plugin/PluginArtifactStore
 *
 * 底层复用 IndexedDBAdapter<PluginArtifact>（keyPath = id），
 * 但**不**经过 ConfigStorageAdapter 的 import()：那个路径零校验、
 * 无条件写入所有 key，会把工件字段冲掉。
 *
 * 注意：IndexedDBAdapter 必须先 initialize() 才能用；
 * createPluginArtifactStore() 工厂负责初始化，类自身也会惰性初始化，
 * 因此直接 new 之后调用 list/get 同样安全。
 */

import { IndexedDBAdapter } from '../storage/adapters/web/IndexedDBAdapter';
import type {
  IPluginArtifactStore,
  PluginArtifact,
} from '../../domain/plugin/types';
import {
  clonePluginArtifact,
  mergePluginArtifact,
  sortArtifactsByRecency,
} from './InMemoryPluginArtifactStore';

export const PLUGIN_ARTIFACT_DB_NAME = 'weiqi-plugin';
export const PLUGIN_ARTIFACT_STORE_NAME = 'artifacts';

export class PluginArtifactStore implements IPluginArtifactStore {
  private readonly adapter: IndexedDBAdapter<PluginArtifact>;
  private initPromise: Promise<void> | null = null;

  constructor(adapter?: IndexedDBAdapter<PluginArtifact>) {
    this.adapter = adapter
      ?? new IndexedDBAdapter<PluginArtifact>(
        PLUGIN_ARTIFACT_DB_NAME,
        PLUGIN_ARTIFACT_STORE_NAME,
      );
  }

  /** 幂等初始化；失败后允许重试 */
  initialize(): Promise<void> {
    const pending = this.initPromise;
    if (pending !== null) {
      return pending;
    }
    const created = this.adapter.initialize().catch((error: unknown) => {
      this.initPromise = null;
      throw error;
    });
    this.initPromise = created;
    return created;
  }

  /** 释放数据库连接（之后再次调用任意方法会重新 initialize） */
  async dispose(): Promise<void> {
    await this.adapter.destroy();
    this.initPromise = null;
  }

  async list(): Promise<PluginArtifact[]> {
    await this.initialize();
    const docs = await this.adapter.find();
    return sortArtifactsByRecency(docs.map(clonePluginArtifact));
  }

  async get(id: string): Promise<PluginArtifact | null> {
    await this.initialize();
    const doc = await this.adapter.findById(id);
    return doc === null ? null : clonePluginArtifact(doc);
  }

  async create(artifact: PluginArtifact): Promise<void> {
    await this.initialize();
    await this.adapter.insert(clonePluginArtifact(artifact));
  }

  async update(id: string, patch: Partial<PluginArtifact>): Promise<void> {
    await this.initialize();
    const existing = await this.adapter.findById(id);
    if (existing === null) {
      throw new Error(`Plugin artifact "${id}" not found`);
    }
    // 先按端口语义合并，再把完整文档交给 adapter.update 覆盖写回。
    // 不直接用 { ...existing, ...patch }：那会写入 undefined 值、
    // 也会让 patch.id 改掉 keyPath 留下孤儿记录。
    await this.adapter.update(id, mergePluginArtifact(existing, patch));
  }

  async remove(id: string): Promise<void> {
    await this.initialize();
    await this.adapter.delete(id);
  }
}

/** 便捷工厂：构造并初始化，供组合根直接注入 */
export async function createPluginArtifactStore(): Promise<PluginArtifactStore> {
  const store = new PluginArtifactStore();
  await store.initialize();
  return store;
}
