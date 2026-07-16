/**
 * @fileoverview 棋谱缓存服务实现
 */

import type { IGameArchiveCache } from './IGameArchiveCache';
import type { ICacheStorage } from '../../infrastructure/storage/interfaces/ICacheStorage';

/**
 * 棋谱缓存服务
 *
 * 缓存归档ID，不缓存实际SGF内容。
 * SGF内容由 GameHistoryStorage 管理。
 */
export class GameArchiveCache implements IGameArchiveCache {
  private readonly cache: ICacheStorage;
  private readonly prefix: string;
  private readonly ttl: number;

  constructor(
    cache: ICacheStorage,
    options?: { prefix?: string; ttl?: number }
  ) {
    this.cache = cache;
    this.prefix = options?.prefix ?? 'game:cache:';
    this.ttl = options?.ttl ?? 3600000; // 默认1小时
  }

  async get(cacheKey: string): Promise<string | null> {
    return await this.cache.get<string>(this.prefix + cacheKey);
  }

  async set(cacheKey: string, archiveId: string): Promise<void> {
    await this.cache.set(this.prefix + cacheKey, archiveId, this.ttl);
  }

  async has(cacheKey: string): Promise<boolean> {
    return await this.cache.has(this.prefix + cacheKey);
  }

  async clear(): Promise<void> {
    await this.cache.clear();
  }
}