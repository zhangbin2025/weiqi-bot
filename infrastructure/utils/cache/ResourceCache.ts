/**
 * 资源缓存工具类
 * @description 提供通用的"获取或下载"缓存能力，减少服务层重复代码
 * 
 * @ai-example
 * const modelCache = new ResourceCache(storage, 'model');
 * const data = await modelCache.getOrDownload('katago', downloader, ttl);
 */

import type { ICacheStorage } from '../../storage/interfaces/ICacheStorage';
import type { IDocumentStorage } from '../../storage/interfaces/IDocumentStorage';
import type { IResourceCacheConfig } from './ResourceCacheTypes';
import { isCacheStorage, getFromStorage, setToStorage } from './ResourceCacheHelper';

/**
 * 资源缓存工具类
 * @description 统一的缓存获取/下载逻辑
 */
export class ResourceCache<T> {
  private config: IResourceCacheConfig;
  private pendingDownloads: Map<string, Promise<T>> = new Map(); // 正在下载的 Promise

  /**
   * 创建资源缓存实例
   * @param storage - 缓存存储或文档存储
   * @param config - 缓存配置
   */
  constructor(
    private readonly storage: ICacheStorage | IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>,
    config: IResourceCacheConfig
  ) {
    this.config = {
      enabled: config.enabled ?? true,
      defaultTTL: config.defaultTTL,
      ...config
    };
  }

  /**
   * 获取或下载资源
   * @description 优先从缓存读取，缓存未命中则下载并存储
   * 
   * @param key - 资源标识
   * @param downloader - 下载函数
   * @param ttl - 缓存时间（毫秒），可选，不传使用默认值
   * @returns 资源数据
   */
  async getOrDownload(
    key: string,
    downloader: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    if (!this.config.enabled) {
      return downloader();
    }

    const cacheKey = this.getCacheKey(key);

    // 1. 尝试从缓存读取
    const cached = await getFromStorage<T>(this.storage, cacheKey);
    if (cached !== null) {
      // 验证缓存数据是否有效（例如 Blob.size > 0）
      const isValid = await this.validateCachedData(cached);
      if (isValid) {
        console.log(`[ResourceCache] Cache hit for key: ${key}`);
        return cached;
      } else {
        console.log(`[ResourceCache] Cache data invalid for key: ${key}, will re-download`);
        // 删除无效缓存
        await this.clear(cacheKey);
      }
    }

    // 2. 检查是否正在下载（防止并发重复下载）
    const pendingPromise = this.pendingDownloads.get(cacheKey);
    if (pendingPromise) {
      console.log(`[ResourceCache] Waiting for pending download: ${key}`);
      return pendingPromise;
    }

    // 3. 开始下载
    console.log(`[ResourceCache] Starting download for key: ${key}`);
    const downloadPromise = (async () => {
      try {
        const data = await downloader();
        
        // 4. 存储到缓存
        const effectiveTTL = ttl ?? this.config.defaultTTL;
        await setToStorage(this.storage, cacheKey, data, effectiveTTL);
        
        console.log(`[ResourceCache] Download complete for key: ${key}`);
        return data;
      } finally {
        // 5. 清除 pending 状态
        this.pendingDownloads.delete(cacheKey);
      }
    })();

    // 存储 Promise 以防止并发下载
    this.pendingDownloads.set(cacheKey, downloadPromise);

    return downloadPromise;
  }

  /**
   * 验证缓存数据是否有效
   * @param data - 缓存的数据
   * @returns 数据是否有效
   */
  private async validateCachedData(data: T): Promise<boolean> {
    // 如果是 Blob，尝试读取一小部分数据来验证是否真的有效
    if (data instanceof Blob) {
      if (data.size === 0) {
        return false;
      }
      
      try {
        // 尝试读取前 1KB 数据，验证 Blob 是否真的可读
        const chunk = data.slice(0, Math.min(1024, data.size));
        const buffer = await chunk.arrayBuffer();
        return buffer.byteLength > 0;
      } catch (error) {
        console.warn('[ResourceCache] Failed to read Blob data:', error);
        return false;
      }
    }
    // 其他类型，默认有效
    return true;
  }

  /**
   * 检查是否已缓存
   * @param key - 资源标识
   * @returns 是否已缓存
   */
  async isCached(key: string): Promise<boolean> {
    const cacheKey = this.getCacheKey(key);
    
    if (isCacheStorage<T>(this.storage)) {
      return (this.storage as ICacheStorage).has(cacheKey);
    } else {
      return (this.storage as IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>).exists(cacheKey);
    }
  }

  /**
   * 获取缓存元数据
   * @param key - 资源标识
   * @returns 缓存元数据（仅 ICacheStorage 支持）
   */
  async getMetadata(key: string): Promise<{
    createdAt?: number;
    expiresAt?: number | null;
    lastAccessedAt?: number;
  } | null> {
    if (!isCacheStorage<T>(this.storage)) {
      return null;
    }

    const cacheKey = this.getCacheKey(key);
    const meta = await (this.storage as ICacheStorage).getMetadata<T>(cacheKey);
    
    if (!meta) return null;
    
    return {
      createdAt: meta.createdAt,
      expiresAt: meta.expiresAt,
      lastAccessedAt: meta.lastAccessedAt
    };
  }

  /**
   * 清除单个缓存
   * @param key - 资源标识
   */
  async clear(key: string): Promise<void> {
    const cacheKey = this.getCacheKey(key);
    
    // 清除缓存数据
    if (isCacheStorage<T>(this.storage)) {
      await (this.storage as ICacheStorage).delete(cacheKey);
    } else {
      await (this.storage as IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>).delete(cacheKey);
    }
    
    // 同时清除 pendingDownloads，确保下次会重新下载
    this.pendingDownloads.delete(cacheKey);
  }

  /**
   * 清除所有缓存（当前前缀）
   */
  async clearAll(): Promise<void> {
    if (isCacheStorage<T>(this.storage)) {
      const keys = await (this.storage as ICacheStorage).keys();
      for (const key of keys) {
        if (key.startsWith(this.config.keyPrefix)) {
          await (this.storage as ICacheStorage).delete(key);
        }
      }
    } else {
      // IDocumentStorage: 直接清空整个存储
      await (this.storage as IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>).clear();
    }
  }

  /**
   * 更新配置
   * @param config - 新配置
   */
  updateConfig(config: Partial<IResourceCacheConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private getCacheKey(key: string): string {
    // IDocumentStorage: use key directly (no prefix needed)
    if (!isCacheStorage<T>(this.storage)) {
      return key;
    }
    // ICacheStorage: add prefix for namespace isolation
    const prefix = this.config.keyPrefix || ''; // 空前缀则不加
    return prefix ? `${prefix}:${key}` : key;
  }

  /**
   * 检查存储类型
   */
  isDocumentStorage(): boolean {
    return !isCacheStorage<T>(this.storage);
  }

  /**
   * 获取底层存储（用于特殊操作）
   */
  getStorage(): ICacheStorage | IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }> {
    return this.storage;
  }
}

/**
 * 创建资源缓存的工厂函数
 * @description 简化创建过程
 */
export function createResourceCache<T>(
  storage: ICacheStorage | IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>,
  keyPrefix: string,
  defaultTTL?: number
): ResourceCache<T> {
  return new ResourceCache<T>(storage, {
    keyPrefix,
    defaultTTL
  });
}
