/**
 * 存储服务接口
 * @module services/storage/IStorageService
 */

/**
 * 存储信息
 */
export interface StorageInfo {
  /** 浏览器缓存大小（字节） */
  cacheSize: number;
  /** IndexedDB 大小（字节） */
  idbSize: number;
  /** LocalStorage 大小（字节） */
  localStorageSize: number;
  /** SessionStorage 大小（字节） */
  sessionStorageSize: number;
  /** 总大小（字节） */
  totalSize: number;
}

/**
 * LocalStorage 项
 */
export interface LocalStorageItem {
  key: string;
  value: string;
  size: number; // 字节数
}

/**
 * SessionStorage 项
 */
export interface SessionStorageItem {
  key: string;
  value: string;
  size: number;
}

/**
 * IndexedDB 数据库信息
 */
export interface IndexedDBDatabase {
  name: string;
  version?: number | undefined;
}

/**
 * IndexedDB 对象存储信息
 */
export interface IndexedDBObjectStore {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexNames: string[];
  count?: number;
}

/**
 * IndexedDB 数据项
 */
export interface IndexedDBItem {
  key: any;
  value: any;
}

/**
 * Cache Storage 缓存信息
 */
export interface CacheStorageInfo {
  name: string;
  count: number;
  size: number;
}

/**
 * Cache Storage 请求信息
 */
export interface CacheRequestInfo {
  url: string;
  method: string;
  status: number;
  contentType?: string | undefined;
  size: number;
}

/**
 * 存储服务接口
 */
export interface IStorageService {
  /**
   * 获取存储信息
   */
  getStorageInfo(): Promise<StorageInfo>;

  /**
   * 清空缓存
   * - 清空 Cache Storage
   * - 清空 IndexedDB
   * - 清空 LocalStorage
   * - 清空 SessionStorage
   */
  clearCache(): Promise<void>;

  /**
   * 格式化大小
   * @param bytes 字节数
   */
  formatSize(bytes: number): string;

  // ========== LocalStorage 浏览 ==========

  /**
   * 列出 LocalStorage 所有项
   */
  listLocalStorage(): Promise<LocalStorageItem[]>;

  /**
   * 获取 LocalStorage 项
   */
  getLocalStorageItem(key: string): string | null;

  /**
   * 清空 LocalStorage
   */
  clearLocalStorage(): Promise<void>;

  // ========== SessionStorage 浏览 ==========

  /**
   * 列出 SessionStorage 所有项
   */
  listSessionStorage(): Promise<SessionStorageItem[]>;

  /**
   * 获取 SessionStorage 项
   */
  getSessionStorageItem(key: string): string | null;

  /**
   * 清空 SessionStorage
   */
  clearSessionStorage(): Promise<void>;

  // ========== IndexedDB 浏览 ==========

  /**
   * 列出 IndexedDB 数据库
   */
  listIndexedDB(): Promise<IndexedDBDatabase[]>;

  /**
   * 列出 IndexedDB 对象存储
   */
  listIndexedDBObjectStores(dbName: string): Promise<IndexedDBObjectStore[]>;

  /**
   * 列出 IndexedDB 数据
   */
  listIndexedDBData(dbName: string, storeName: string, limit?: number, offset?: number): Promise<IndexedDBItem[]>;

  /**
   * 获取 IndexedDB 项
   */
  getIndexedDBItem(dbName: string, storeName: string, key: any): Promise<any>;

  /**
   * 清空 IndexedDB
   */
  clearIndexedDB(dbName?: string): Promise<void>;

  // ========== Cache Storage 浏览 ==========

  /**
   * 列出 Cache Storage
   */
  listCacheStorage(): Promise<CacheStorageInfo[]>;

  /**
   * 列出 Cache Storage 请求
   */
  listCacheRequests(cacheName: string, limit?: number, offset?: number): Promise<CacheRequestInfo[]>;

  /**
   * 获取 Cache Storage 响应
   */
  getCacheResponse(cacheName: string, url: string): Promise<any>;

  /**
   * 清空 Cache Storage
   */
  clearCacheStorage(cacheName?: string): Promise<void>;

  // ========== 导出导入 ==========

  /**
   * 导出用户数据
   * @returns ZIP 文件 Blob
   */
  exportUserData(): Promise<Blob>;

  /**
   * 导入用户数据
   * @param blob - ZIP 文件 Blob
   */
  importUserData(blob: Blob): Promise<void>;
}
