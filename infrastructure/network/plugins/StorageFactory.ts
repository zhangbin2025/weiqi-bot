/**
 * 存储工厂
 * @description 根据类型自动创建存储适配器
 */

import type { IKeyValueStorage } from '../../storage/interfaces';

/**
 * 存储类型
 */
export type StorageType = 'memory' | 'localStorage' | 'indexedDB' | 'jsonFile';

/**
 * 内存存储适配器
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
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return keys.filter(key => regex.test(key));
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

/**
 * 存储工厂
 */
export class StorageFactory {
  /**
   * 创建存储适配器
   */
  static async create(
    type: StorageType = 'memory',
    namespace: string = 'network'
  ): Promise<IKeyValueStorage> {
    switch (type) {
      case 'memory':
        return new MemoryStorageAdapter();

      case 'localStorage':
        return await StorageFactory.createLocalStorage(namespace);

      case 'indexedDB':
        return await StorageFactory.createIndexedDB(namespace);

      case 'jsonFile':
        return await StorageFactory.createJsonFile(namespace);

      default:
        throw new Error(`Unknown storage type: ${type}`);
    }
  }

  /**
   * 创建 localStorage 适配器
   */
  private static async createLocalStorage(namespace: string): Promise<IKeyValueStorage> {
    // 检查是否在浏览器环境
    if (typeof window === 'undefined' || !window.localStorage) {
      console.warn('localStorage not available, falling back to memory storage');
      return new MemoryStorageAdapter();
    }

    // 动态导入 LocalStorageAdapter
    try {
      const { LocalStorageAdapter } = await import(
        '../../storage/adapters/web/LocalStorageAdapter'
      );
      const adapter = new LocalStorageAdapter(namespace);
      await adapter.initialize();
      return adapter;
    } catch (error) {
      console.warn('Failed to load LocalStorageAdapter, falling back to memory storage');
      return new MemoryStorageAdapter();
    }
  }

  /**
   * 创建 IndexedDB 适配器
   */
  private static async createIndexedDB(namespace: string): Promise<IKeyValueStorage> {
    // 检查是否在浏览器环境
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB not available, falling back to memory storage');
      return new MemoryStorageAdapter();
    }

    // 动态导入 IndexedDBAdapter
    try {
      const { IndexedDBAdapter } = await import(
        '../../storage/adapters/web/IndexedDBAdapter'
      );
      const adapter = new IndexedDBAdapter(namespace, 'key-value-store') as unknown as IKeyValueStorage;
      await adapter.initialize();
      return adapter;
    } catch (error) {
      console.warn('Failed to load IndexedDBAdapter, falling back to memory storage');
      return new MemoryStorageAdapter();
    }
  }

  /**
   * 创建 JsonFile 适配器（Node.js 环境）
   */
  private static async createJsonFile(namespace: string): Promise<IKeyValueStorage> {
    // 检查是否在 Node.js 环境
    if (typeof process === 'undefined' || !process.versions?.node) {
      console.warn('JsonFile storage only available in Node.js, falling back to memory storage');
      return new MemoryStorageAdapter();
    }

    // 动态导入 JsonFileAdapter
    try {
      // 假设有 JsonFileAdapter（如果没有，可以使用内存存储）
      console.warn('JsonFileAdapter not implemented yet, using memory storage');
      return new MemoryStorageAdapter();
    } catch (error) {
      console.warn('Failed to load JsonFileAdapter, falling back to memory storage');
      return new MemoryStorageAdapter();
    }
  }

  /**
   * 检查存储类型是否可用
   */
  static isAvailable(type: StorageType): boolean {
    switch (type) {
      case 'memory':
        return true;

      case 'localStorage':
        return typeof window !== 'undefined' && !!window.localStorage;

      case 'indexedDB':
        return typeof window !== 'undefined' && !!window.indexedDB;

      case 'jsonFile':
        return typeof process !== 'undefined' && !!process.versions?.node;

      default:
        return false;
    }
  }

  /**
   * 获取可用的存储类型列表
   */
  static getAvailableTypes(): StorageType[] {
    const types: StorageType[] = ['memory'];

    if (this.isAvailable('localStorage')) {
      types.push('localStorage');
    }

    if (this.isAvailable('indexedDB')) {
      types.push('indexedDB');
    }

    if (this.isAvailable('jsonFile')) {
      types.push('jsonFile');
    }

    return types;
  }
}
