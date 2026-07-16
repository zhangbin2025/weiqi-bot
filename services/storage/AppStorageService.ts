/**
 * App 端存储服务实现
 * @module services/storage/AppStorageService
 */

import type { IStorageService, StorageInfo, LocalStorageItem, SessionStorageItem, IndexedDBDatabase, IndexedDBObjectStore, IndexedDBItem, CacheStorageInfo, CacheRequestInfo } from './IStorageService';
import { StorageExportImport } from './export-import';

/**
 * 存储详细信息
 */
export interface DetailedStorageInfo extends StorageInfo {
  /** App 内部存储大小（字节） */
  appFilesSize: number;
  /** App 缓存存储大小（字节） */
  appCacheSize: number;
  /** Web 存储大小（字节） - GeckoView */
  webStorageSize: number;
}

/**
 * App 端存储服务
 * 
 * 同时统计：
 * - Web 存储（通过 Web API）
 * - App 存储（通过 Android DebugBridge）
 */
export class AppStorageService implements IStorageService {
  private exportImport: StorageExportImport;

  constructor() {
    this.exportImport = new StorageExportImport(this);
  }

  /**
   * 调用 Android DebugBridge 方法（通过 prompt）
   */
  private callDebugBridge(action: string, arg?: string): string {
    try {
      const message = arg ? `debug:${action}:${arg}` : `debug:${action}`;
      const result = prompt(message);
      return result || '';
    } catch (error) {
      console.error(`[AppStorageService] Failed to call ${action}:`, error);
      return '';
    }
  }

  /**
   * 获取存储信息
   */
  async getStorageInfo(): Promise<DetailedStorageInfo> {
    try {
      // 1. 获取 Web 存储大小（使用 Web API）
      const webCacheSize = await this.getCacheStorageSize();
      const webIDBSize = await this.getIDBSize();
      const webLocalStorageSize = this.getLocalStorageSize();
      const webSessionStorageSize = this.getSessionStorageSize();
      const webStorageSize = webCacheSize + webIDBSize + webLocalStorageSize + webSessionStorageSize;

      // 2. 获取 App 存储大小（使用 Android API）
      const filesDir = this.callDebugBridge('getFilesDir');
      const cacheDir = this.callDebugBridge('getCacheDir');
      
      const appFilesSize = parseInt(this.callDebugBridge('getFileSize', filesDir) || '0', 10);
      const appCacheSize = parseInt(this.callDebugBridge('getFileSize', cacheDir) || '0', 10);

      // 3. 计算总计（Web + App）
      const totalSize = webStorageSize + appFilesSize + appCacheSize;

      return {
        cacheSize: webCacheSize,
        idbSize: webIDBSize,
        localStorageSize: webLocalStorageSize,
        sessionStorageSize: webSessionStorageSize,
        totalSize,
        // 额外字段
        appFilesSize,
        appCacheSize,
        webStorageSize,
      };
    } catch (error) {
      console.error('[AppStorageService] Failed to get storage info:', error);
      return {
        cacheSize: 0,
        idbSize: 0,
        localStorageSize: 0,
        sessionStorageSize: 0,
        totalSize: 0,
        appFilesSize: 0,
        appCacheSize: 0,
        webStorageSize: 0,
      };
    }
  }

  /**
   * 清空缓存（同时清理 Web 和 App）
   */
  async clearCache(): Promise<void> {
    try {
      // 1. 清空 Web 存储（使用 Web API）
      await this.clearCacheStorage();
      await this.clearIndexedDB();
      await this.clearLocalStorage();
      await this.clearSessionStorage();

      // 2. 清空 App 缓存（调用 Android API）
      const result = this.callDebugBridge('clearCache');
      const success = result === 'true';

      if (!success) {
        throw new Error('Android clearCache returned false');
      }

      console.log('[AppStorageService] All cache cleared');
    } catch (error) {
      // 如果只是 IndexedDB 关闭错误，忽略它
      if (error instanceof Error && error.message.includes('closed database')) {
        console.log('[AppStorageService] Cache cleared (with IndexedDB closed warning)');
        return;
      }
      
      console.error('[AppStorageService] Failed to clear cache:', error);
      throw error;
    }
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

  // ========== Web 存储统计方法 ==========

  private async getCacheStorageSize(): Promise<number> {
    try {
      if (!('caches' in window)) return 0;

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
      console.error('[AppStorageService] Failed to get cache storage size:', error);
      return 0;
    }
  }

  private async getIDBSize(): Promise<number> {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        // estimate.usage 包括 Cache Storage + IndexedDB
        // 我们需要减去 Cache Storage 的部分
        const cacheSize = await this.getCacheStorageSize();
        const localStorageSize = this.getLocalStorageSize();
        const sessionStorageSize = this.getSessionStorageSize();
        return Math.max(0, (estimate.usage || 0) - cacheSize - localStorageSize - sessionStorageSize);
      }
      return 0;
    } catch (error) {
      console.error('[AppStorageService] Failed to get IndexedDB size:', error);
      return 0;
    }
  }

  private getLocalStorageSize(): number {
    try {
      if (!('localStorage' in window)) return 0;

      let totalSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value) {
            totalSize += new Blob([key + value]).size;
          }
        }
      }

      return totalSize;
    } catch (error) {
      console.error('[AppStorageService] Failed to get localStorage size:', error);
      return 0;
    }
  }

  private getSessionStorageSize(): number {
    try {
      if (!('sessionStorage' in window)) return 0;

      let totalSize = 0;
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          const value = sessionStorage.getItem(key);
          if (value) {
            totalSize += new Blob([key + value]).size;
          }
        }
      }

      return totalSize;
    } catch (error) {
      console.error('[AppStorageService] Failed to get sessionStorage size:', error);
      return 0;
    }
  }

  // ========== LocalStorage 浏览 ==========

  /**
   * 列出 LocalStorage 所有项
   */
  async clearLocalStorage(): Promise<void> {
    try {
      if (!('localStorage' in window)) return;
      localStorage.clear();
      console.log('[AppStorageService] LocalStorage cleared');
    } catch (error) {
      console.error('[AppStorageService] Failed to clear localStorage:', error);
    }
  }

  /**
   * 清空 SessionStorage
   */
  async clearSessionStorage(): Promise<void> {
    try {
      if (!('sessionStorage' in window)) return;
      sessionStorage.clear();
      console.log('[AppStorageService] SessionStorage cleared');
    } catch (error) {
      console.error('[AppStorageService] Failed to clear sessionStorage:', error);
    }
  }

  // ========== LocalStorage 浏览 ==========

  /**
   * 列出 LocalStorage 所有项
   */
  async listLocalStorage(): Promise<LocalStorageItem[]> {
    try {
      if (!('localStorage' in window)) return [];

      const items: LocalStorageItem[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key) || '';
          const size = new Blob([key + value]).size;
          items.push({ key, value, size });
        }
      }

      return items.sort((a, b) => b.size - a.size);
    } catch (error) {
      console.error('[AppStorageService] Failed to list localStorage:', error);
      return [];
    }
  }

  /**
   * 获取 LocalStorage 项
   */
  getLocalStorageItem(key: string): string | null {
    try {
      if (!('localStorage' in window)) return null;
      return localStorage.getItem(key);
    } catch (error) {
      console.error('[AppStorageService] Failed to get localStorage item:', error);
      return null;
    }
  }

  // ========== SessionStorage 浏览 ==========

  /**
   * 列出 SessionStorage 所有项
   */
  async listSessionStorage(): Promise<SessionStorageItem[]> {
    try {
      if (!('sessionStorage' in window)) return [];

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
      console.error('[AppStorageService] Failed to list sessionStorage:', error);
      return [];
    }
  }

  /**
   * 获取 SessionStorage 项
   */
  getSessionStorageItem(key: string): string | null {
    try {
      if (!('sessionStorage' in window)) return null;
      return sessionStorage.getItem(key);
    } catch (error) {
      console.error('[AppStorageService] Failed to get sessionStorage item:', error);
      return null;
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
      console.error('[AppStorageService] Failed to list IndexedDB:', error);
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
        console.error('[AppStorageService] Failed to open database:', request.error);
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
          console.error('[AppStorageService] Failed to open cursor:', cursorRequest.error);
          db.close();
          resolve([]);
        };
      };

      request.onerror = () => {
        console.error('[AppStorageService] Failed to open database:', request.error);
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
          console.error('[AppStorageService] Failed to get item:', getRequest.error);
          db.close();
          resolve(null);
        };
      };

      request.onerror = () => {
        console.error('[AppStorageService] Failed to open database:', request.error);
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
        await new Promise<void>((resolve) => {
          try {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
            request.onblocked = () => resolve();
          } catch (e) {
            resolve();
          }
        });
      } else {
        const databases = await indexedDB.databases();
        for (const db of databases) {
          if (db.name) {
            await new Promise<void>((resolve) => {
              try {
                const request = indexedDB.deleteDatabase(db.name!);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
              } catch (e) {
                resolve();
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('[AppStorageService] Failed to clear IndexedDB:', error);
    }
  }

  // ========== Cache Storage 浏览 ==========

  /**
   * 列出 Cache Storage
   */
  async listCacheStorage(): Promise<CacheStorageInfo[]> {
    try {
      if (!('caches' in window)) return [];

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
      console.error('[AppStorageService] Failed to list cache storage:', error);
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
      if (!('caches' in window)) return [];

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
      console.error('[AppStorageService] Failed to list cache requests:', error);
      return [];
    }
  }

  /**
   * 获取 Cache Storage 响应
   */
  async getCacheResponse(cacheName: string, url: string): Promise<any> {
    try {
      if (!('caches' in window)) return null;

      const cache = await caches.open(cacheName);
      const request = new Request(url);
      const response = await cache.match(request);

      if (!response) return null;

      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        return await response.json();
      } else if (contentType?.includes('text/')) {
        return await response.text();
      } else {
        return await response.blob();
      }
    } catch (error) {
      console.error('[AppStorageService] Failed to get cache response:', error);
      return null;
    }
  }

  /**
   * 清空 Cache Storage
   */
  async clearCacheStorage(cacheName?: string): Promise<void> {
    try {
      if (!('caches' in window)) return;

      if (cacheName) {
        await caches.delete(cacheName);
      } else {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
      }
    } catch (error) {
      console.error('[AppStorageService] Failed to clear cache storage:', error);
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
