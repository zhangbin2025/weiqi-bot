/**
 * SessionStorage 服务实现
 * @description 封装 sessionStorage 操作，提供会话级存储
 */

import type { ISessionStorageService } from './ISessionStorageService';
import type { IKeyValueStorage } from '../../infrastructure/storage/interfaces/IKeyValueStorage';

/**
 * SessionStorage 服务
 * 
 * 提供会话级键值存储，数据在会话期间有效，关闭标签页后清除。
 * 
 * @example
 * ```typescript
 * const storage = new SessionStorageAdapter('my-app');
 * await storage.initialize();
 * const service = new SessionStorageService(storage);
 * 
 * // 设置数据
 * await service.set('cache-key', { data: 'value' });
 * 
 * // 获取数据
 * const data = await service.get<{ data: string }>('cache-key');
 * ```
 */
export class SessionStorageService implements ISessionStorageService {
  constructor(private readonly storage: IKeyValueStorage) {}

  async get<T>(key: string): Promise<T | null> {
    return await this.storage.read<T>(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.storage.write(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.storage.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return await this.storage.exists(key);
  }

  async clear(): Promise<void> {
    await this.storage.clear();
  }
}
