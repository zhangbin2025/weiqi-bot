/**
 * 存储服务模块
 * @module services/storage
 */

export { WebStorageService } from './WebStorageService';
export { AppStorageService } from './AppStorageService';
export { StorageBrowserService } from './StorageBrowserService';

export type {
  IStorageService,
  StorageInfo,
  LocalStorageItem,
  SessionStorageItem,
  IndexedDBDatabase,
  IndexedDBObjectStore,
  IndexedDBItem,
  CacheStorageInfo,
  CacheRequestInfo,
} from './IStorageService';

export type { StorageBrowserConfig, StorageType } from './StorageBrowserService';
