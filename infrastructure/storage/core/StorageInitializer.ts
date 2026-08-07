/**
 * Storage 初始化器
 * @description 从 ConfigManager 初始化 Storage 模块
 */

import type { IConfigProvider } from '../../config/interfaces';
import type { IStorageConfig } from '../../config/schemas/StorageConfigSchema';
import { StorageConfigSchema } from '../../config/schemas/StorageConfigSchema';
import { StorageAdapterFactory, type AdapterType } from './StorageAdapterFactory';
import { StoragePluginRegistry } from './StoragePluginRegistry';
import type { IKeyValueStorageAdapter } from '../interfaces/IKeyValueStorage';
import type { ICacheStorageAdapter } from '../interfaces/ICacheStorage';
import type { IFileStorageAdapter } from '../interfaces/IFileStorage';

/**
 * Storage 初始化结果
 */
export interface IStorageInitializeResult {
  /** 配置对象 */
  config: IStorageConfig;
  /** 插件注册器 */
  registry: StoragePluginRegistry;
  /** 默认键值存储适配器 */
  defaultKVAdapter: IKeyValueStorageAdapter;
  /** 默认缓存适配器 */
  defaultCacheAdapter: ICacheStorageAdapter;
  /** 默认文件适配器（可选） */
  defaultFileAdapter?: IFileStorageAdapter | undefined;
}

/**
 * Storage 初始化选项
 */
export interface IStorageInitOptions {
  /** 配置提供者（ConfigManager） */
  configProvider: IConfigProvider;
  /** 是否创建默认文件适配器 */
  createFileAdapter?: boolean;
  /** 文件适配器类型 */
  fileAdapterType?: AdapterType;
  /** 文件适配器额外配置 */
  fileAdapterExtra?: Record<string, unknown>;
}

/**
 * Storage 模块名称（用于从 ConfigManager 获取配置）
 */
export const STORAGE_MODULE_NAME = 'storage';

/**
 * Storage 初始化器
 * @description 从 ConfigManager 初始化 Storage 模块
 */
export class StorageInitializer {
  /**
   * 初始化 Storage 模块
   * @description 从 ConfigManager 获取配置并创建默认适配器
   */
  static async initialize(
    options: IStorageInitOptions
  ): Promise<IStorageInitializeResult> {
    const {
      configProvider,
      createFileAdapter = false,
      fileAdapterType = 'nodeFS',
      fileAdapterExtra,
    } = options;

    // 从 ConfigManager 获取配置
    const config = await configProvider.getModuleConfig<IStorageConfig>(
      STORAGE_MODULE_NAME
    );

    // 创建插件注册器
    const registry = new StoragePluginRegistry();

    // 创建默认键值存储适配器
    const defaultKVAdapter = StorageAdapterFactory.createKeyValueAdapter({
      config,
      type: 'memory',
    });

    // 初始化适配器
    await defaultKVAdapter.initialize();
    registry.register(defaultKVAdapter);

    // 创建默认缓存适配器
    const defaultCacheAdapter = StorageAdapterFactory.createCacheAdapter({
      config,
      type: 'memory',
    });

    await defaultCacheAdapter.initialize();

    // 创建默认文件适配器（可选）
    let defaultFileAdapter: IFileStorageAdapter | undefined;
    if (createFileAdapter) {
      defaultFileAdapter = StorageAdapterFactory.createFileAdapter({
        config,
        type: fileAdapterType,
        extra: fileAdapterExtra,
      });

      await defaultFileAdapter.initialize();
    }

    return {
      config,
      registry,
      defaultKVAdapter,
      defaultCacheAdapter,
      defaultFileAdapter,
    };
  }

  /**
   * 注册 Storage 配置模式到 ConfigManager
   */
  static registerSchema(configProvider: IConfigProvider): void {
    configProvider.registerSchema(STORAGE_MODULE_NAME, StorageConfigSchema);
  }
}
