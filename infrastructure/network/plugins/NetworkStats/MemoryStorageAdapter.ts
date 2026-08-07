/**
 * 内存存储适配器
 * @description 提供内存存储实现，用于网络统计数据
 */

import type { IKeyValueStorage } from '../../../storage/interfaces/IKeyValueStorage';

/**
 * 内存存储适配器
 */
export class MemoryStorageAdapter implements IKeyValueStorage {
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
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return keys.filter(key => regex.test(key));
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}