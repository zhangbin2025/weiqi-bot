/**
 * 存储接口导出
 */
export type {
  IKeyValueStorage,
  IKeyValueStorageAdapter,
} from './IKeyValueStorage';

export type {
  IStoragePluginRegistry,
  IStoragePluginDescriptor,
  IStoragePluginLoader,
} from './IStoragePluginRegistry';

export type {
  IDocumentStorage,
  IDocumentStorageAdapter,
} from './IDocumentStorage';

export type {
  QueryCriteria,
  StorageAdapterType,
} from './IDocumentStorage';

export type {
  ICacheStorage,
  ICacheStorageAdapter,
  ICacheItem,
} from './ICacheStorage';

export type {
  CacheAdapterType,
} from './ICacheStorage';

export type {
  IFileStorage,
  IFileStorageAdapter,
  IFileMetadata,
} from './IFileStorage';

export type {
  FileAdapterType,
} from './IFileStorage';
