/**
 * 核心模块导出
 */
export { StoragePluginRegistry, StoragePluginLoader } from './StoragePluginRegistry';
export { StorageAdapterFactory } from './StorageAdapterFactory';
export type { AdapterType, IAdapterCreateOptions } from './StorageAdapterFactory';
export { StorageInitializer, STORAGE_MODULE_NAME } from './StorageInitializer';
export type { IStorageInitOptions, IStorageInitializeResult } from './StorageInitializer';
