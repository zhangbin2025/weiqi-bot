/**
 * Web 端存储服务实现
 * @module services/storage/WebStorageService
 */

import type { IStorageService, StorageInfo, LocalStorageItem, SessionStorageItem, IndexedDBDatabase, IndexedDBObjectStore, IndexedDBItem, CacheStorageInfo, CacheRequestInfo } from './IStorageService';
import { StorageExportImport } from './export-import';

/**
 * Web 端存储服务
 * 
 * 管理浏览器缓存、IndexedDB、LocalStorage
 */
export class WebStorageService implements IStorageService {
  private exportImport: StorageExportImport;

  constructor() {
    this.exportImport = new StorageExportImport(this);
  }
  /**
   * 获取存储信息
   */
  async getStorageInfo(): Promise<StorageInfo> {
    // 1. Cache Storage
    const cacheSize = await this.getCacheStorageSize();

    // 2. IndexedDB + LocalStorage（使用 Storage API）
    const totalUsage = await this.getIDBSize();
    // Storage API 返回的是总使用量，需要减去 Cache Storage 和 LocalStorage
    const localStorageSize = this.getLocalStorageSize();
    const sessionStorageSize = this.getSessionStorageSize();
    const idbSize = Math.max(0, totalUsage - cacheSize - localStorageSize - sessionStorageSize);

    const totalSize = totalUsage + sessionStorageSize;

    return {
      cacheSize,
      idbSize,
      localStorageSize,
      sessionStorageSize,
      totalSize,
    };
  }

  /**
   * 清空缓存
   */
  async clearCache(): Promise<void> {
    // 1. 清空 Cache Storage
    await this.clearCacheStorage();

    // 2. 清空 IndexedDB
    await this.clearIndexedDB();

    // 3. 清空 LocalStorage
    await this.clearLocalStorage();

    // 4. 清空 SessionStorage
    await this.clearSessionStorage();

    console.log('[WebStorageService] 缓存已清空');
  }

  /**
   * 格式化大小
   */
  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
  }

  /**
   * 获取 Cache Storage 大小
   */
  private async getCacheStorageSize(): Promise<number> {
    try {
      // 检查 Cache API 是否可用
      if (!('caches' in window)) {
        return 0;
      }

      const cacheNames = await caches.keys();
      let totalSize = 0;

      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const keys = await cache.keys();

        for (const request of keys) {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            totalSize += blob.size;
          }
        }
      }

      return totalSize;
    } catch (error) {
      console.error('[WebStorageService] Failed to get cache storage size:', error);
      return 0;
    }
  }

  /**
   * 获取 IndexedDB 大小
   */
  private async getIDBSize(): Promise<number> {
    try {
      // 使用 Storage API（如果可用）
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        // estimate.usage 包括 Cache Storage 和 IndexedDB
        // 我们需要减去 Cache Storage 的大小，得到 IndexedDB + LocalStorage 的大小
        // 但由于 Cache Storage 已经单独计算，这里我们返回 estimate.usage - cacheSize
        // 不过这里的 cacheSize 是在外部计算的，所以我们先返回 estimate.usage
        // 然后在 getStorageInfo() 中调整
        return estimate.usage || 0;
      }

      // 回退方案：遍历已知数据库估算大小
      // 由于没有直接的 API，返回 0
      return 0;
    } catch (error) {
      console.error('[WebStorageService] Failed to get IndexedDB size:', error);
      return 0;
    }
  }

  /**
   * 获取 LocalStorage 大小
   */
  private getLocalStorageSize(): number {
    try {
      if (!('localStorage' in window)) {
        return 0;
      }

      let totalSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value) {
            // 计算字符串的字节数（UTF-8）
            totalSize += new Blob([key + value]).size;
          }
        }
      }

      return totalSize;
    } catch (error) {
      console.error('[WebStorageService] Failed to get localStorage size:', error);
      return 0;
    }
  }

  /**
   * 获取 SessionStorage 大小
   */
  private getSessionStorageSize(): number {
    try {
      if (!('sessionStorage' in window)) {
        return 0;
      }

      let totalSize = 0;
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          const value = sessionStorage.getItem(key);
          if (value) {
            // 计算字符串的字节数（UTF-8）
            totalSize += new Blob([key + value]).size;
          }
        }
      }

      return totalSize;
    } catch (error) {
      console.error('[WebStorageService] Failed to get sessionStorage size:', error);
      return 0;
    }
  }

  // ========== LocalStorage 浏览 ==========

  /**
   * 列出 LocalStorage 所有项
   */
  async listLocalStorage(): Promise<LocalStorageItem[]> {
    try {
      if (!('localStorage' in window)) {
        return [];
      }

      const items: LocalStorageItem[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key) || '';
          const size = new Blob([key + value]).size;
          items.push({ key, value, size });
        }
      }

      return items.sort((a, b) => b.size - a.size); // 按大小降序
    } catch (error) {
      console.error('[WebStorageService] Failed to list localStorage:', error);
      return [];
    }
  }

  /**
   * 获取 LocalStorage 项
   */
  getLocalStorageItem(key: string): string | null {
    try {
      if (!('localStorage' in window)) {
        return null;
      }
      return localStorage.getItem(key);
    } catch (error) {
      console.error('[WebStorageService] Failed to get localStorage item:', error);
      return null;
    }
  }

  /**
   * 清空 LocalStorage
   */
  async clearLocalStorage(): Promise<void> {
    try {
      if (!('localStorage' in window)) {
        return;
      }

      localStorage.clear();
      console.log('[WebStorageService] LocalStorage 已清空');
    } catch (error) {
      console.error('[WebStorageService] Failed to clear localStorage:', error);
    }
  }

  // ========== SessionStorage 浏览 ==========

  /**
   * 列出 SessionStorage 所有项
   */
  async listSessionStorage(): Promise<SessionStorageItem[]> {
    try {
      if (!('sessionStorage' in window)) {
        return [];
      }

      const items: SessionStorageItem[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          const value = sessionStorage.getItem(key) || '';
          const size = new Blob([key + value]).size;
          items.push({ key, value, size });
        }
      }

      return items.sort((a, b) => b.size - a.size);
    } catch (error) {
      console.error('[WebStorageService] Failed to list sessionStorage:', error);
      return [];
    }
  }

  /**
   * 获取 SessionStorage 项
   */
  getSessionStorageItem(key: string): string | null {
    try {
      if (!('sessionStorage' in window)) {
        return null;
      }
      return sessionStorage.getItem(key);
    } catch (error) {
      console.error('[WebStorageService] Failed to get sessionStorage item:', error);
      return null;
    }
  }

  /**
   * 清空 SessionStorage
   */
  async clearSessionStorage(): Promise<void> {
    try {
      if (!('sessionStorage' in window)) {
        return;
      }

      sessionStorage.clear();
      console.log('[WebStorageService] SessionStorage 已清空');
    } catch (error) {
      console.error('[WebStorageService] Failed to clear sessionStorage:', error);
    }
  }

  // ========== IndexedDB 浏览 ==========

  /**
   * 列出 IndexedDB 数据库
   */
  async listIndexedDB(): Promise<IndexedDBDatabase[]> {
    try {
      const databases = await indexedDB.databases();
      return databases.map(db => ({
        name: db.name || 'unknown',
        version: db.version,
      }));
    } catch (error) {
      console.error('[WebStorageService] Failed to list IndexedDB:', error);
      return [];
    }
  }

  /**
   * 列出 IndexedDB 对象存储
   */
  async listIndexedDBObjectStores(dbName: string): Promise<IndexedDBObjectStore[]> {
    return new Promise((resolve) => {
      const request = indexedDB.open(dbName);

      request.onsuccess = () => {
        const db = request.result;
        const storeNames = Array.from(db.objectStoreNames);

        const stores: IndexedDBObjectStore[] = storeNames.map(name => {
          const transaction = db.transaction(name, 'readonly');
          const store = transaction.objectStore(name);

          return {
            name,
            keyPath: store.keyPath as string | string[] | null,
            autoIncrement: store.autoIncrement,
            indexNames: Array.from(store.indexNames),
          };
        });

        db.close();
        resolve(stores);
      };

      request.onerror = () => {
        console.error('[WebStorageService] Failed to open database:', request.error);
        resolve([]);
      };
    });
  }

  /**
   * 列出 IndexedDB 数据
   */
  async listIndexedDBData(
    dbName: string,
    storeName: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<IndexedDBItem[]> {
    return new Promise((resolve) => {
      const request = indexedDB.open(dbName);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const items: IndexedDBItem[] = [];

        // 使用游标遍历
        const cursorRequest = store.openCursor();
        let skipped = 0;
        let count = 0;

        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

          if (cursor) {
            if (skipped < offset) {
              skipped++;
              cursor.continue();
              return;
            }

            items.push({
              key: cursor.key,
              value: cursor.value,
            });

            count++;
            if (count < limit) {
              cursor.continue();
            } else {
              db.close();
              resolve(items);
            }
          } else {
            db.close();
            resolve(items);
          }
        };

        cursorRequest.onerror = () => {
          console.error('[WebStorageService] Failed to open cursor:', cursorRequest.error);
          db.close();
          resolve([]);
        };
      };

      request.onerror = () => {
        console.error('[WebStorageService] Failed to open database:', request.error);
        resolve([]);
      };
    });
  }

  /**
   * 获取 IndexedDB 项
   */
  async getIndexedDBItem(dbName: string, storeName: string, key: any): Promise<any> {
    return new Promise((resolve) => {
      const request = indexedDB.open(dbName);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const getRequest = store.get(key);

        getRequest.onsuccess = () => {
          db.close();
          resolve(getRequest.result);
        };

        getRequest.onerror = () => {
          console.error('[WebStorageService] Failed to get item:', getRequest.error);
          db.close();
          resolve(null);
        };
      };

      request.onerror = () => {
        console.error('[WebStorageService] Failed to open database:', request.error);
        resolve(null);
      };
    });
  }

  /**
   * 清空 IndexedDB
   */
  async clearIndexedDB(dbName?: string): Promise<void> {
    try {
      if (dbName) {
        // 删除指定数据库
        await this.deleteDatabase(dbName);
      } else {
        // 删除所有数据库
        // 方法1: 使用 indexedDB.databases() API（如果可用）
        if (typeof indexedDB.databases === 'function') {
          try {
            const databases = await indexedDB.databases();
            for (const db of databases) {
              if (db.name) {
                await this.deleteDatabase(db.name);
              }
            }
          } catch (error) {
            console.warn('[WebStorageService] indexedDB.databases() not available, using fallback');
            // 如果 databases() 不可用，使用已知数据库列表
            await this.clearKnownDatabases();
          }
        } else {
          // 如果 databases() 不可用，使用已知数据库列表
          await this.clearKnownDatabases();
        }
        console.log('[WebStorageService] IndexedDB 已清空');
      }
    } catch (error) {
      console.error('[WebStorageService] Failed to clear IndexedDB:', error);
    }
  }

  /**
   * 删除单个数据库
   */
  private async deleteDatabase(dbName: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => {
        console.log(`[WebStorageService] Database ${dbName} 已删除`);
        resolve();
      };
      request.onerror = () => {
        console.error(`[WebStorageService] Failed to delete database ${dbName}:`, request.error);
        resolve();
      };
      request.onblocked = () => {
        console.warn(`[WebStorageService] Database ${dbName} is blocked, force closing...`);
        // 尝试关闭数据库连接后再删除
        resolve();
      };
    });
  }

  /**
   * 清空已知数据库（用于不支持 indexedDB.databases() 的浏览器）
   */
  private async clearKnownDatabases(): Promise<void> {
    // 常见的数据库名称列表
    const knownDatabases = [
      'file-storage',           // IndexedDBFileAdapter 默认名称
      'weiqi-files',            // 可能的自定义名称
      'model-cache',            // 模型缓存
      'joseki-cache',           // 定式库缓存
      'game-history',           // 游戏历史
      'task-storage',           // 任务存储
      'cache-db',               // 通用缓存
      'weiqi-bot',              // 应用主数据库
      'tensorflowjs',           // TensorFlow.js 模型缓存数据库
    ];

    for (const dbName of knownDatabases) {
      try {
        await this.deleteDatabase(dbName);
      } catch (error) {
        // 忽略删除失败的数据库（可能不存在）
      }
    }
  }

  // ========== Cache Storage 浏览 ==========

  /**
   * 列出 Cache Storage
   */
  async listCacheStorage(): Promise<CacheStorageInfo[]> {
    try {
      if (!('caches' in window)) {
        return [];
      }

      const cacheNames = await caches.keys();
      const infos: CacheStorageInfo[] = [];

      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        let totalSize = 0;

        for (const request of keys) {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            totalSize += blob.size;
          }
        }

        infos.push({
          name,
          count: keys.length,
          size: totalSize,
        });
      }

      return infos.sort((a, b) => b.size - a.size);
    } catch (error) {
      console.error('[WebStorageService] Failed to list cache storage:', error);
      return [];
    }
  }

  /**
   * 列出 Cache Storage 请求
   */
  async listCacheRequests(
    cacheName: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<CacheRequestInfo[]> {
    try {
      if (!('caches' in window)) {
        return [];
      }

      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      const infos: CacheRequestInfo[] = [];

      for (let i = offset; i < Math.min(offset + limit, keys.length); i++) {
        const request = keys[i];
        
        if (!request) continue;
        
        const response = await cache.match(request);

        if (response) {
          const blob = await response.blob();
          infos.push({
            url: request.url,
            method: request.method,
            status: response.status,
            contentType: response.headers.get('content-type') || undefined,
            size: blob.size,
          });
        }
      }

      return infos;
    } catch (error) {
      console.error('[WebStorageService] Failed to list cache requests:', error);
      return [];
    }
  }

  /**
   * 获取 Cache Storage 响应
   */
  async getCacheResponse(cacheName: string, url: string): Promise<any> {
    try {
      if (!('caches' in window)) {
        return null;
      }

      const cache = await caches.open(cacheName);
      const request = new Request(url);
      const response = await cache.match(request);

      if (!response) {
        return null;
      }

      const contentType = response.headers.get('content-type');

      // 根据内容类型返回不同的数据
      if (contentType?.includes('application/json')) {
        return await response.json();
      } else if (contentType?.includes('text/')) {
        return await response.text();
      } else {
        return await response.blob();
      }
    } catch (error) {
      console.error('[WebStorageService] Failed to get cache response:', error);
      return null;
    }
  }

  /**
   * 清空 Cache Storage
   */
  async clearCacheStorage(cacheName?: string): Promise<void> {
    try {
      if (!('caches' in window)) {
        return;
      }

      if (cacheName) {
        await caches.delete(cacheName);
        console.log(`[WebStorageService] Cache ${cacheName} 已删除`);
      } else {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
        console.log('[WebStorageService] Cache Storage 已清空');
      }
    } catch (error) {
      console.error('[WebStorageService] Failed to clear cache storage:', error);
    }
  }

  // ========== 导出导入 ==========

  /**
   * 导出用户数据
   */
  async exportUserData(): Promise<Blob> {
    return this.exportImport.exportUserData();
  }

  /**
   * 导入用户数据
   */
  async importUserData(blob: Blob): Promise<void> {
    return this.exportImport.importUserData(blob);
  }
}
