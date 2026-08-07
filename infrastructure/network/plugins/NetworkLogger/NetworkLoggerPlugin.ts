/**
 * 网络日志插件
 * @description 记录所有网络请求的插件
 */

import type { INetworkPlugin, IProviderRegistry, INetworkProvider } from '../../interfaces';
import { NetworkLoggerProvider } from './NetworkLoggerProvider';
import { NetworkLogStorage } from './NetworkLogStorage';
import { StorageFactory, type StorageType } from '../StorageFactory';
import type { INetworkLoggerConfig, INetworkLogEntry, INetworkLogQueryOptions } from './NetworkLoggerTypes';

/**
 * 网络日志插件
 */
export class NetworkLoggerPlugin implements INetworkPlugin {
  readonly name = 'network-logger';
  readonly version = '1.0.0';

  private storage: NetworkLogStorage;
  private config: INetworkLoggerConfig;
  private loggerProviders: Map<string, NetworkLoggerProvider> = new Map();

  constructor(config: INetworkLoggerConfig = {}) {
    this.config = config;
    this.storage = new NetworkLogStorage(config.maxEntries ?? 1000);
  }

  /**
   * 注册插件
   */
  register(registry: IProviderRegistry): void {
    // 获取所有现有提供者
    const providers = registry.getProviders();

    // 包装每个提供者
    providers.forEach((provider) => {
      this.wrapProvider(registry, provider);
    });
  }

  /**
   * 初始化插件
   */
  async initialize(): Promise<void> {
    console.log(`[NetworkLoggerPlugin] Initialized`);
  }

  /**
   * 销毁插件
   */
  async destroy(): Promise<void> {
    this.loggerProviders.clear();
    console.log(`[NetworkLoggerPlugin] Destroyed`);
  }

  /**
   * 获取所有日志
   */
  async getLogs(): Promise<INetworkLogEntry[]> {
    return await this.storage.getAll();
  }

  /**
   * 查询日志
   */
  async queryLogs(options: INetworkLogQueryOptions): Promise<INetworkLogEntry[]> {
    return await this.storage.query(options);
  }

  /**
   * 根据 ID 获取日志
   */
  async getLogById(id: string): Promise<INetworkLogEntry | undefined> {
    return await this.storage.getById(id);
  }

  /**
   * 清空日志
   */
  clearLogs(): void {
    this.storage.clear();
  }

  /**
   * 获取日志数量
   */
  async getLogCount(): Promise<number> {
    return await this.storage.count();
  }

  /**
   * 导出日志
   */
  async exportLogs(): Promise<string> {
    return await this.storage.export();
  }

  /**
   * 导入日志
   */
  importLogs(json: string): void {
    this.storage.import(json);
  }

  /**
   * 启用日志
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * 禁用日志
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled ?? true;
  }

  /**
   * 切换存储类型
   */
  async useStorage(type: StorageType, namespace?: string): Promise<void> {
    const storage = await StorageFactory.create(type, namespace ?? 'network-logger');
    this.storage.setStorage(storage);
    console.log(`[NetworkLoggerPlugin] Switched to ${type} storage`);
  }

  /**
   * 包装提供者
   */
  private wrapProvider(
    registry: IProviderRegistry,
    provider: INetworkProvider
  ): void {
    // 创建包装器
    const loggerProvider = new NetworkLoggerProvider(
      provider,
      this.storage,
      this.config
    );

    // 注销原提供者
    registry.unregister(provider.name);

    // 注册包装器
    registry.register(loggerProvider);

    // 保存引用
    this.loggerProviders.set(provider.name, loggerProvider);
  }
}
