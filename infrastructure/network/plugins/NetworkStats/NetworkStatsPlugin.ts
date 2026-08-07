/**
 * 网络统计插件
 * @description 统计所有网络请求的插件
 */

import type { INetworkPlugin, IProviderRegistry, INetworkProvider } from '../../interfaces';
import { NetworkStatsProvider } from './NetworkStatsProvider';
import { NetworkStatsStorage } from './NetworkStatsStorage';
import { StorageFactory, type StorageType } from '../StorageFactory';
import type {
  INetworkStatsConfig,
  INetworkStats,
  IUrlStats,
  IMethodStats,
  IProviderStats
} from './NetworkStatsTypes';

/**
 * 网络统计插件
 */
export class NetworkStatsPlugin implements INetworkPlugin {
  readonly name = 'network-stats';
  readonly version = '1.0.0';

  private storage: NetworkStatsStorage;
  private config: INetworkStatsConfig;
  private statsProviders: Map<string, NetworkStatsProvider> = new Map();

  constructor(config: INetworkStatsConfig = {}) {
    this.config = config;
    this.storage = new NetworkStatsStorage(config);
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
    console.log(`[NetworkStatsPlugin] Initialized`);
  }

  /**
   * 销毁插件
   */
  async destroy(): Promise<void> {
    this.statsProviders.clear();
    console.log(`[NetworkStatsPlugin] Destroyed`);
  }

  /**
   * 获取全局统计
   */
  getStats(): INetworkStats {
    return this.storage.getGlobalStats();
  }

  /**
   * 按URL统计
   */
  getUrlStats(): IUrlStats[] {
    return this.storage.getUrlStats();
  }

  /**
   * 按方法统计
   */
  getMethodStats(): IMethodStats[] {
    return this.storage.getMethodStats();
  }

  /**
   * 按提供者统计
   */
  getProviderStats(): IProviderStats[] {
    return this.storage.getProviderStats();
  }

  /**
   * 清空统计
   */
  clearStats(): void {
    this.storage.clear();
  }

  /**
   * 启用统计
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * 禁用统计
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
    const storage = await StorageFactory.create(type, namespace ?? 'network-stats');
    await this.storage.setStorage(storage);
    console.log(`[NetworkStatsPlugin] Switched to ${type} storage`);
  }

  /**
   * 包装提供者
   */
  private wrapProvider(
    registry: IProviderRegistry,
    provider: INetworkProvider
  ): void {
    // 创建包装器
    const statsProvider = new NetworkStatsProvider(
      provider,
      this.storage,
      this.config
    );

    // 注销原提供者
    registry.unregister(provider.name);

    // 注册包装器
    registry.register(statsProvider);

    // 保存引用
    this.statsProviders.set(provider.name, statsProvider);
  }
}
