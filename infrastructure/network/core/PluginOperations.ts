/**
 * 插件操作助手
 * @description 封装网络管理器的插件相关操作逻辑
 */

import { PluginManager } from './PluginManager';
import { ProviderRegistry } from './ProviderRegistry';
import { DefaultNetworkStrategy } from './DefaultNetworkStrategy';
import type { INetworkPlugin } from '../interfaces';

/**
 * 插件操作助手类
 * @description 处理网络管理器中的插件加载、卸载和查询操作
 */
export class PluginOperations {
  constructor(
    private pluginManager: PluginManager,
    private registry: ProviderRegistry,
    private strategy: DefaultNetworkStrategy
  ) {}

  /**
   * 加载插件
   */
  async loadPlugin(plugin: INetworkPlugin): Promise<void> {
    await this.pluginManager.loadPlugin(plugin);
    // 更新策略的提供者列表
    this.strategy.setProviders(this.registry.getProviders());
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(name: string): Promise<void> {
    await this.pluginManager.unloadPlugin(name);
    // 更新策略的提供者列表
    this.strategy.setProviders(this.registry.getProviders());
  }

  /**
   * 获取所有插件
   */
  getPlugins(): INetworkPlugin[] {
    return this.pluginManager.getPlugins();
  }

  /**
   * 获取插件
   */
  getPlugin(name: string): INetworkPlugin | undefined {
    return this.pluginManager.getPlugin(name);
  }

  /**
   * 检查插件是否已加载
   */
  hasPlugin(name: string): boolean {
    return this.pluginManager.hasPlugin(name);
  }
}
