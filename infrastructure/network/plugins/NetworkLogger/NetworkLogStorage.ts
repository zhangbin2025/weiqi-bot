/**
 * 网络日志存储（集成 storage 模块）
 * @description 存储网络日志记录，支持多种存储后端
 */

import type { INetworkLogEntry, INetworkLogQueryOptions } from './NetworkLoggerTypes';
import type { IKeyValueStorage } from '../../../storage/interfaces/IKeyValueStorage';

/**
 * 内存存储适配器（简单的键值存储）
 */
class MemoryStorageAdapter implements IKeyValueStorage {
  async initialize(): Promise<void> { /* no-op */ }
  private data: Map<string, unknown> = new Map();

  async read<T>(key: string): Promise<T | null> {
    const value = this.data.get(key);
    return value !== undefined ? (value as T) : null;
  }

  async write<T>(key: string, data: T): Promise<void> {
    this.data.set(key, data);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async listKeys(pattern?: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());
    if (!pattern) return keys;

    // 简单的通配符匹配
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return keys.filter(key => regex.test(key));
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

/**
 * 网络日志存储
 */
export class NetworkLogStorage {
  private storage: IKeyValueStorage;
  private entries: INetworkLogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 1000, storage?: IKeyValueStorage) {
    this.maxEntries = maxEntries;
    this.storage = storage ?? new MemoryStorageAdapter();
  }

  /**
   * 设置存储适配器
   */
  setStorage(storage: IKeyValueStorage): void {
    this.storage = storage;
  }

  /**
   * 添加日志条目
   */
  async add(entry: INetworkLogEntry): Promise<void> {
    this.entries.push(entry);

    // 超过最大数量时删除最旧的
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // 持久化到存储
    await this.storage.write('network-logs', this.entries);
  }

  /**
   * 获取所有日志
   */
  async getAll(): Promise<INetworkLogEntry[]> {
    // 尝试从存储中加载
    const stored = await this.storage.read<INetworkLogEntry[]>('network-logs');
    if (stored) {
      this.entries = stored;
    }
    return [...this.entries];
  }

  /**
   * 查询日志
   */
  async query(options: INetworkLogQueryOptions): Promise<INetworkLogEntry[]> {
    const entries = await this.getAll();
    let result = [...entries];

    if (options.startTime) {
      result = result.filter((e) => e.timestamp >= options.startTime!);
    }

    if (options.endTime) {
      result = result.filter((e) => e.timestamp <= options.endTime!);
    }

    if (options.urlPattern) {
      const pattern = new RegExp(options.urlPattern, 'i');
      result = result.filter((e) => pattern.test(e.request.url));
    }

    if (options.method) {
      result = result.filter(
        (e) => e.request.method.toLowerCase() === options.method!.toLowerCase()
      );
    }

    if (options.success !== undefined) {
      result = result.filter((e) => e.success === options.success);
    }

    if (options.provider) {
      result = result.filter((e) => e.provider === options.provider);
    }

    if (options.limit) {
      result = result.slice(-options.limit);
    }

    return result;
  }

  /**
   * 根据 ID 获取日志
   */
  async getById(id: string): Promise<INetworkLogEntry | undefined> {
    const entries = await this.getAll();
    return entries.find((e) => e.id === id);
  }

  /**
   * 清空日志
   */
  async clear(): Promise<void> {
    this.entries = [];
    await this.storage.delete('network-logs');
  }

  /**
   * 获取日志数量
   */
  async count(): Promise<number> {
    const entries = await this.getAll();
    return entries.length;
  }

  /**
   * 导出日志为 JSON
   */
  async export(): Promise<string> {
    const entries = await this.getAll();
    return JSON.stringify(entries, null, 2);
  }

  /**
   * 导入日志
   */
  async import(json: string): Promise<void> {
    try {
      const entries = JSON.parse(json) as INetworkLogEntry[];
      this.entries = entries;
      await this.storage.write('network-logs', entries);
    } catch (error) {
      throw new Error('Failed to import logs: invalid JSON format');
    }
  }
}
