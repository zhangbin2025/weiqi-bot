import {
  ICacheStorageAdapter,
  ICacheItem,
  CacheAdapterType,
} from '../../interfaces/ICacheStorage';

/**
 * LocalStorage 缓存适配器
 * @description 使用浏览器 localStorage 实现缓存存储，支持 TTL 自动过期
 *
 * ## 适用场景
 * - 会话数据持久化（页面跳转后不丢失）
 * - 小型缓存数据（< 5MB）
 * - 需要自动过期的临时数据
 *
 * ## 使用示例
 * ```typescript
 * const cache = new LocalStorageCacheAdapter('my-cache');
 * await cache.initialize();
 *
 * // 写入缓存（5分钟后过期）
 * await cache.set('session-id', { data: 'value' }, 5 * 60 * 1000);
 *
 * // 读取缓存
 * const data = await cache.get<{ data: string }>('session-id');
 * ```
 */
export class LocalStorageCacheAdapter implements ICacheStorageAdapter {
  readonly name: string;
  readonly type = CacheAdapterType.LocalStorage;

  /**
   * @param namespace - 命名空间，用于隔离不同应用的数据
   */
  constructor(private readonly namespace: string = 'cache') {
    this.name = `localStorage:${namespace}`;
  }

  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('localStorage is not available');
    }
  }

  async destroy(): Promise<void> {
    await this.clear();
  }

  isAvailable(): boolean {
    try {
      // 检查 localStorage 是否存在
      if (typeof localStorage === 'undefined') {
        console.warn('[LocalStorageCacheAdapter] localStorage API 不存在（可能在非浏览器环境中）');
        return false;
      }
      
      // 尝试读写测试
      const testKey = '__cache_test__';
      localStorage.setItem(testKey, testKey);
      localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      console.warn('[LocalStorageCacheAdapter] localStorage 不可用:', {
        error: error instanceof Error ? error.message : String(error),
        type: error instanceof Error ? error.constructor.name : typeof error,
      });
      return false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);
    const data = localStorage.getItem(fullKey);
    if (!data) return null;

    try {
      const item: ICacheItem<T> = JSON.parse(data);

      // 检查是否过期
      if (item.expiresAt && Date.now() > item.expiresAt) {
        localStorage.removeItem(fullKey);
        return null;
      }

      // 更新最后访问时间
      item.lastAccessedAt = Date.now();
      localStorage.setItem(fullKey, JSON.stringify(item));

      return item.data;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const now = Date.now();

    const item: ICacheItem<T> = {
      data,
      expiresAt: ttl ? now + ttl : null,
      createdAt: now,
      lastAccessedAt: now,
    };

    localStorage.setItem(fullKey, JSON.stringify(item));
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    localStorage.removeItem(fullKey);
  }

  async has(key: string): Promise<boolean> {
    const data = await this.get(key);
    return data !== null;
  }

  async isExpired(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    const data = localStorage.getItem(fullKey);
    if (!data) return true;

    try {
      const item: ICacheItem<unknown> = JSON.parse(data);
      if (!item.expiresAt) return false;
      return Date.now() > item.expiresAt;
    } catch {
      return true;
    }
  }

  async clear(): Promise<void> {
    const keys = await this.keys();
    for (const key of keys) {
      await this.delete(key);
    }
  }

  async size(): Promise<number> {
    const keys = await this.keys();
    return keys.length;
  }

  async getSize(): Promise<number> {
    const keys = await this.keys();
    let totalSize = 0;

    for (const key of keys) {
      const fullKey = this.getFullKey(key);
      const data = localStorage.getItem(fullKey);
      if (data) {
        totalSize += fullKey.length * 2 + data.length * 2;
      }
    }

    return totalSize;
  }

  async cleanup(): Promise<number> {
    const keys = await this.keys();
    let cleaned = 0;

    for (const key of keys) {
      if (await this.isExpired(key)) {
        await this.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  async keys(): Promise<string[]> {
    const prefix = `${this.namespace}:`;
    const keys: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i);
      if (fullKey && fullKey.startsWith(prefix)) {
        const key = fullKey.substring(prefix.length);
        keys.push(key);
      }
    }

    return keys;
  }

  async getMetadata<T>(key: string): Promise<ICacheItem<T> | null> {
    const fullKey = this.getFullKey(key);
    const data = localStorage.getItem(fullKey);
    if (!data) return null;

    try {
      return JSON.parse(data) as ICacheItem<T>;
    } catch {
      return null;
    }
  }

  private getFullKey(key: string): string {
    return `${this.namespace}:${key}`;
  }
}
