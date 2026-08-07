/**
 * 已读标记服务实现
 */

import type { IKeyValueStorage } from '../../infrastructure/storage/interfaces';
import type { IReadMarkService } from './IReadMarkService';
import type { ReadMarkStorage } from './types';

/** 存储键前缀 */
const STORAGE_KEY_PREFIX = 'readmark:';

export class ReadMarkService implements IReadMarkService {
  constructor(
    private readonly storage: IKeyValueStorage,
    
  ) {}

  async markRead(category: string, id: string): Promise<void> {
    const key = this.getStorageKey(category);
    const data = await this.loadData(key);
    
    if (!data.ids.includes(id)) {
      data.ids.push(id);
      data.updatedAt = Date.now();
      await this.saveData(key, data);
      console.debug(`标记已读: ${category}/${id}`);
    }
  }

  async markReadBatch(category: string, ids: string[]): Promise<void> {
    const key = this.getStorageKey(category);
    const data = await this.loadData(key);
    
    const newIds = ids.filter(id => !data.ids.includes(id));
    if (newIds.length > 0) {
      data.ids.push(...newIds);
      data.updatedAt = Date.now();
      await this.saveData(key, data);
      console.debug(`批量标记已读: ${category}/${newIds.length}个`);
    }
  }

  async isRead(category: string, id: string): Promise<boolean> {
    const key = this.getStorageKey(category);
    const data = await this.loadData(key);
    return data.ids.includes(id);
  }

  async getReadMarks(category: string): Promise<string[]> {
    const key = this.getStorageKey(category);
    const data = await this.loadData(key);
    return [...data.ids];
  }

  async clearReadMarks(category: string): Promise<void> {
    const key = this.getStorageKey(category);
    await this.storage.delete(key);
    console.debug(`清除已读标记: ${category}`);
  }

  // ===== 私有方法 =====

  private getStorageKey(category: string): string {
    return `${STORAGE_KEY_PREFIX}${category}`;
  }

  private async loadData(key: string): Promise<ReadMarkStorage> {
    const data = await this.storage.read<ReadMarkStorage>(key);
    return data ?? { ids: [], updatedAt: 0 };
  }

  private async saveData(key: string, data: ReadMarkStorage): Promise<void> {
    await this.storage.write(key, data);
  }
}
