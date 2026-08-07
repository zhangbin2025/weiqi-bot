/**
 * Storage 适配器工厂
 * @description 提供统一的适配器创建接口，支持从配置创建适配器
 */

import type { IStorageConfig } from '../../config/schemas/StorageConfigSchema';
import { MemoryAdapter } from '../adapters/common/MemoryAdapter';
import { LocalStorageAdapter } from '../adapters/web/LocalStorageAdapter';
import { IndexedDBAdapter } from '../adapters/web/IndexedDBAdapter';
import { IndexedDBFileAdapter } from '../adapters/web/IndexedDBFileAdapter';
import { NodeFileAdapter } from '../adapters/cli/NodeFileAdapter';
import { JsonFileAdapter } from '../adapters/cli/JsonFileAdapter';
import type { IKeyValueStorageAdapter } from '../interfaces/IKeyValueStorage';
import type { ICacheStorageAdapter } from '../interfaces/ICacheStorage';
import type { IFileStorageAdapter } from '../interfaces/IFileStorage';
import type { IDocumentStorageAdapter } from '../interfaces/IDocumentStorage';

/**
 * 适配器类型
 */
export type AdapterType = 
  | 'memory'
  | 'localStorage'
  | 'indexedDB'
  | 'nodeFS'
  | 'jsonFile';

/**
 * 适配器创建选项
 */
export interface IAdapterCreateOptions {
  /** 配置对象 */
  config: IStorageConfig;
  /** 适配器类型 */
 type: AdapterType;
  /** 额外选项（如 dbName、storeName 等） */
  extra?: Record<string, unknown> | undefined;
}

/**
 * Storage 适配器工厂类
 * @description 根据配置创建对应的存储适配器
 */
export class StorageAdapterFactory {
  /**
   * 创建键值存储适配器
   */
  static createKeyValueAdapter(
    options: IAdapterCreateOptions
  ): IKeyValueStorageAdapter {
    const { config, type, extra } = options;

    switch (type) {
      case 'localStorage':
        return new LocalStorageAdapter(
          (extra?.['namespace'] as string) ?? config.defaultNamespace
        );

      case 'jsonFile':
        return new JsonFileAdapter(
          (extra?.['filePath'] as string) ?? `./data/${config.defaultNamespace}.json`
        );

      case 'memory':
      default:
        // MemoryAdapter 现在支持完整配置
        return new MemoryAdapter({ config }) as unknown as IKeyValueStorageAdapter;
    }
  }

  /**
   * 创建缓存存储适配器
   */
  static createCacheAdapter(
    options: IAdapterCreateOptions
  ): ICacheStorageAdapter {
    const { config, type } = options;

    switch (type) {
      case 'memory':
      default:
        return new MemoryAdapter({ config }) as unknown as ICacheStorageAdapter;
    }
  }

  /**
   * 创建文件存储适配器
   */
  static createFileAdapter(
    options: IAdapterCreateOptions
  ): IFileStorageAdapter {
    const { config, type, extra } = options;

    switch (type) {
      case 'indexedDB':
        return new IndexedDBFileAdapter(
          (extra?.['dbName'] as string) ?? `${config.defaultNamespace}-files`
        );

      case 'nodeFS':
        return new NodeFileAdapter(
          (extra?.['basePath'] as string) ?? `./storage/${config.defaultNamespace}`
        );

      default:
        throw new Error(`Unsupported file adapter type: ${type}`);
    }
  }

  /**
   * 创建文档存储适配器
   */
  static createDocumentAdapter<T extends { id: string }>(
    options: IAdapterCreateOptions
  ): IDocumentStorageAdapter<T> {
    const { config, type, extra } = options;

    switch (type) {
      case 'indexedDB':
        return new IndexedDBAdapter<T>(
          (extra?.['dbName'] as string) ?? config.defaultNamespace,
          (extra?.['storeName'] as string) ?? 'documents',
          (extra?.['version'] as number) ?? 1
        );

      case 'jsonFile':
        return new JsonFileAdapter<T>(
          (extra?.['filePath'] as string) ?? `./data/${config.defaultNamespace}.json`
        );

      default:
        throw new Error(`Unsupported document adapter type: ${type}`);
    }
  }
}
