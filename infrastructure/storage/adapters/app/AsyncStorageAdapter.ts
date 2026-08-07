/**
 * AsyncStorage 文档存储适配器
 * @description 用于 RN 环境，使用 AsyncStorage 实现持久化文档存储
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IDocumentStorage, QueryCriteria } from '../../interfaces/IDocumentStorage';

/**
 * AsyncStorage 文档存储适配器
 * @description 使用 AsyncStorage 实现持久化文档存储，应用重启后数据不丢失
 */
export class AsyncStorageAdapter<T extends { id: string }> implements IDocumentStorage<T> {
  private initialized = false;

  constructor(private readonly storageKey: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // AsyncStorage 不需要特殊初始化
    this.initialized = true;
  }

  async insert(doc: T): Promise<string> {
    const docs = await this.loadAll();
    if (docs.some(d => d.id === doc.id)) {
      throw new Error(`Document with id "${doc.id}" already exists`);
    }
    docs.push(doc);
    await this.saveAll(docs);
    return doc.id;
  }

  async insertMany(docs: T[]): Promise<string[]> {
    const existing = await this.loadAll();
    const ids = new Set(existing.map(d => d.id));
    const newDocs: T[] = [];

    for (const doc of docs) {
      if (ids.has(doc.id)) {
        throw new Error(`Document with id "${doc.id}" already exists`);
      }
      newDocs.push(doc);
    }

    existing.push(...newDocs);
    await this.saveAll(existing);
    return newDocs.map(d => d.id);
  }

  async update(id: string, doc: Partial<T>): Promise<void> {
    const docs = await this.loadAll();
    const idx = docs.findIndex(d => d.id === id);
    if (idx === -1) {
      throw new Error(`Document with id "${id}" not found`);
    }
    docs[idx] = { ...docs[idx], ...doc } as T;
    await this.saveAll(docs);
  }

  async delete(id: string): Promise<void> {
    const docs = await this.loadAll();
    const filtered = docs.filter(d => d.id !== id);
    await this.saveAll(filtered);
  }

  async deleteMany(ids: string[]): Promise<void> {
    const idSet = new Set(ids);
    const docs = await this.loadAll();
    const filtered = docs.filter(d => !idSet.has(d.id));
    await this.saveAll(filtered);
  }

  async findById(id: string): Promise<T | null> {
    const docs = await this.loadAll();
    return docs.find(d => d.id === id) ?? null;
  }

  async find(criteria?: QueryCriteria): Promise<T[]> {
    let results = await this.loadAll();

    if (criteria?.where) {
      results = results.filter(doc => {
        for (const [key, value] of Object.entries(criteria.where!)) {
          if ((doc as Record<string, unknown>)[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    if (criteria?.orderBy) {
      const order = criteria.orderDirection === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[criteria.orderBy!];
        const bVal = (b as Record<string, unknown>)[criteria.orderBy!];
        if (aVal === bVal) return 0;
        if (aVal === undefined || aVal === null) return order;
        if (bVal === undefined || bVal === null) return -order;
        return aVal < bVal ? -order : order;
      });
    }

    if (criteria?.offset !== undefined) {
      results = results.slice(criteria.offset);
    }

    if (criteria?.limit !== undefined) {
      results = results.slice(0, criteria.limit);
    }

    return results;
  }

  async findOne(criteria?: QueryCriteria): Promise<T | null> {
    const results = await this.find(criteria);
    return results[0] ?? null;
  }

  async count(criteria?: QueryCriteria): Promise<number> {
    if (!criteria?.where) {
      const docs = await this.loadAll();
      return docs.length;
    }
    const results = await this.find(criteria);
    return results.length;
  }

  async exists(id: string): Promise<boolean> {
    const doc = await this.findById(id);
    return doc !== null;
  }

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(this.storageKey);
  }

  /** 加载所有文档 */
  private async loadAll(): Promise<T[]> {
    try {
      const data = await AsyncStorage.getItem(this.storageKey);
      if (!data) return [];
      return JSON.parse(data) as T[];
    } catch {
      return [];
    }
  }

  /** 保存所有文档 */
  private async saveAll(docs: T[]): Promise<void> {
    await AsyncStorage.setItem(this.storageKey, JSON.stringify(docs));
  }
}
