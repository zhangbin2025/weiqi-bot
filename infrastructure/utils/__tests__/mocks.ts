/**
 * 测试 Mock 工厂
 * @description 提供统一的 mock 对象创建
 */

import type { ICacheStorage, ICacheItem } from '../../storage/interfaces/ICacheStorage';
import type { IDocumentStorage } from '../../storage/interfaces/IDocumentStorage';

export const createMockCacheStorage = (): jest.Mocked<ICacheStorage> => {
  const store: Map<string, ICacheItem<unknown>> = new Map();
  
  return {
    get: jest.fn(async <T>(key: string): Promise<T | null> => {
      const item = store.get(key);
      if (!item) return null;
      if (item.expiresAt && Date.now() > item.expiresAt) return null;
      return item.data as T;
    }),
    set: jest.fn(async <T>(key: string, data: T, ttl?: number): Promise<void> => {
      store.set(key, {
        data,
        expiresAt: ttl ? Date.now() + ttl : null,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      });
    }),
    delete: jest.fn(async (key: string): Promise<void> => {
      store.delete(key);
    }),
    has: jest.fn(async (key: string): Promise<boolean> => {
      const item = store.get(key);
      if (!item) return false;
      if (item.expiresAt && Date.now() > item.expiresAt) return false;
      return true;
    }),
    isExpired: jest.fn(async (key: string): Promise<boolean> => {
      const item = store.get(key);
      if (!item) return true;
      if (item.expiresAt && Date.now() > item.expiresAt) return true;
      return false;
    }),
    clear: jest.fn(async (): Promise<void> => {
      store.clear();
    }),
    size: jest.fn(async (): Promise<number> => store.size),
    getSize: jest.fn(async (): Promise<number> => 0),
    cleanup: jest.fn(async (): Promise<number> => 0),
    keys: jest.fn(async (): Promise<string[]> => Array.from(store.keys())),
    getMetadata: jest.fn(async <T>(key: string): Promise<ICacheItem<T> | null> => {
      const item = store.get(key);
      return item ? (item as ICacheItem<T>) : null;
    }),
  };
};

export const createMockDocumentStorage = (): jest.Mocked<IDocumentStorage<{ id: string; blob: unknown; timestamp: number; size: number }>> => {
  const store: Map<string, { id: string; blob: unknown; timestamp: number; size: number }> = new Map();
  
  return {
    insert: jest.fn(async (doc): Promise<string> => {
      store.set(doc.id, doc);
      return doc.id;
    }),
    insertMany: jest.fn(async (docs): Promise<string[]> => {
      for (const doc of docs) {
        store.set(doc.id, doc);
      }
      return docs.map(d => d.id);
    }),
    update: jest.fn(async (id: string, doc): Promise<void> => {
      const existing = store.get(id);
      if (existing) {
        store.set(id, { ...existing, ...doc });
      }
    }),
    delete: jest.fn(async (id: string): Promise<void> => {
      store.delete(id);
    }),
    deleteMany: jest.fn(async (ids: string[]): Promise<void> => {
      for (const id of ids) {
        store.delete(id);
      }
    }),
    findById: jest.fn(async (id: string) => store.get(id) || null),
    find: jest.fn(async () => Array.from(store.values())),
    findOne: jest.fn(async () => {
      const values = Array.from(store.values());
      return values[0] || null;
    }),
    count: jest.fn(async () => store.size),
    exists: jest.fn(async (id: string): Promise<boolean> => store.has(id)),
    clear: jest.fn(async (): Promise<void> => {
      store.clear();
    }),
  };
};