/**
 * 资源缓存辅助函数
 * @description 提供存储操作、大小计算等辅助功能
 */

import type { ICacheStorage } from '../../storage/interfaces/ICacheStorage';
import type { IDocumentStorage } from '../../storage/interfaces/IDocumentStorage';

/**
 * 判断是否为 ICacheStorage
 */
export function isCacheStorage<T>(
  storage: ICacheStorage | IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>
): boolean {
  return 'get' in storage && 'set' in storage && 'has' in storage;
}

/**
 * 计算数据大小
 */
export function getDataSize<T>(data: T): number {
  if (data instanceof Blob) {
    return data.size;
  }
  if (typeof data === 'string') {
    return data.length;
  }
  return JSON.stringify(data).length;
}

/**
 * 从存储读取
 */
export async function getFromStorage<T>(
  storage: ICacheStorage | IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>,
  key: string,
  usePrefix: boolean = true
): Promise<T | null> {
  if (isCacheStorage<T>(storage)) {
    return (storage as ICacheStorage).get<T>(key);
  } else {
    // IDocumentStorage: use key directly (no prefix needed)
    const doc = await (storage as IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>).findById(key);
    return doc?.blob ?? null;
  }
}

/**
 * 写入存储
 */
export async function setToStorage<T>(
  storage: ICacheStorage | IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>,
  key: string,
  data: T,
  ttl?: number
): Promise<void> {
  if (isCacheStorage<T>(storage)) {
    await (storage as ICacheStorage).set(key, data, ttl);
  } else {
    await (storage as IDocumentStorage<{ id: string; blob: T; timestamp: number; size: number }>).insert({
      id: key,
      blob: data,
      timestamp: Date.now(),
      size: getDataSize(data)
    });
  }
}
