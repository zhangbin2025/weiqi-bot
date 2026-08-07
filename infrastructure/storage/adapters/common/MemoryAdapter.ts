import {
  ICacheStorageAdapter,
  ICacheItem,
  CacheAdapterType,
} from '../../interfaces/ICacheStorage';
import type { IStorageConfig } from '../../../config/schemas/StorageConfigSchema';

/** Memory 缓存适配器配置选项 */
export interface IMemoryAdapterOptions {
  name?: string;
  maxSize?: number;
  config?: IStorageConfig;
}

/**
 * Memory 缓存适配器
 * @description 使用内存 Map 实现缓存存储，支持 TTL、自动清理、容量统计
 * @ai-example
 * const cache = new MemoryAdapter({ config: storageConfig });
 * await cache.initialize();
 */
export class MemoryAdapter implements ICacheStorageAdapter {
  readonly name: string;
  readonly type = CacheAdapterType.Memory;

  private cache = new Map<string, ICacheItem<unknown>>();
  private maxSize: number;
  private initialized = false;

  constructor(options?: IMemoryAdapterOptions) {
    if (options?.config) {
      this.maxSize = options.config.cache.l1MaxSize;
      this.name = `memory:${options.config.defaultNamespace}`;
    } else {
      this.maxSize = options?.maxSize ?? 50 * 1024 * 1024;
      this.name = options?.name ?? 'memory:default';
    }
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async destroy(): Promise<void> {
    this.cache.clear();
    this.initialized = false;
  }

  isAvailable(): boolean {
    return true;
  }

  async get<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key);
    if (!item) return null;

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    item.lastAccessedAt = Date.now();
    return item.data as T;
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const now = Date.now();
    const item: ICacheItem<T> = {
      data,
      expiresAt: ttl ? now + ttl : null,
      createdAt: now,
      lastAccessedAt: now,
    };
    this.cache.set(key, item as ICacheItem<unknown>);
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const item = this.cache.get(key);
    if (!item) return false;

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  async isExpired(key: string): Promise<boolean> {
    const item = this.cache.get(key);
    if (!item) return true;
    if (!item.expiresAt) return false;
    return Date.now() > item.expiresAt;
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async size(): Promise<number> {
    return this.cache.size;
  }

  async getSize(): Promise<number> {
    let totalSize = 0;
    for (const [key, item] of this.cache) {
      totalSize += key.length * 2;
      totalSize += this.estimateSize(item.data);
      totalSize += 24;
    }
    return totalSize;
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, item] of this.cache) {
      if (item.expiresAt && now > item.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  async keys(): Promise<string[]> {
    return Array.from(this.cache.keys());
  }

  async getMetadata<T>(key: string): Promise<ICacheItem<T> | null> {
    const item = this.cache.get(key);
    return item ? (item as ICacheItem<T>) : null;
  }

  /** 估算数据大小（字节） */
  private estimateSize(data: unknown): number {
    if (data === null || data === undefined) {
      return 0;
    }

    if (typeof data === 'string') {
      return data.length * 2; // UTF-16 编码
    }

    if (typeof data === 'number') {
      return 8; // 64位浮点数
    }

    if (typeof data === 'boolean') {
      return 4;
    }

    if (data instanceof ArrayBuffer) {
      return data.byteLength;
    }

    if (Array.isArray(data)) {
      return data.reduce((sum, item) => sum + this.estimateSize(item), 0);
    }

    if (typeof data === 'object') {
      return JSON.stringify(data).length * 2;
    }

    return 0;
  }
}
