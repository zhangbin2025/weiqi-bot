/**
 * 插件管理器
 * @description 管理网络插件的加载、卸载和生命周期
 * @ai-example
 * const pluginManager = new PluginManager();
 * await pluginManager.loadPlugin(new NetworkLoggerPlugin());
 */

import type { INetworkPlugin, IProviderRegistry } from '../interfaces';

/**
 * 插件管理器实现
 */
export class PluginManager {
  private plugins: Map<string, INetworkPlugin> = new Map();
  private registry: IProviderRegistry;

  constructor(registry: IProviderRegistry) {
    this.registry = registry;
  }

  /**
   * 加载插件
   */
  async loadPlugin(plugin: INetworkPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" already loaded`);
    }

    // 检查依赖
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(
            `Plugin "${plugin.name}" depends on "${dep}", but it's not loaded`
          );
        }
      }
    }

    // 注册插件
    plugin.register(this.registry);

    // 初始化插件
    if (plugin.initialize) {
      await plugin.initialize();
    }

    // 保存插件
    this.plugins.set(plugin.name, plugin);

    console.log(`[PluginManager] Plugin "${plugin.name}" loaded`);
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);

    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }

    // 检查是否有其他插件依赖此插件
    for (const [pluginName, p] of this.plugins.entries()) {
      if (p.dependencies && p.dependencies.includes(name)) {
        throw new Error(
          `Cannot unload plugin "${name}": plugin "${pluginName}" depends on it`
        );
      }
    }

    // 销毁插件
    if (plugin.destroy) {
      await plugin.destroy();
    }

    // 移除插件
    this.plugins.delete(name);

    console.log(`[PluginManager] Plugin "${name}" unloaded`);
  }

  /**
   * 获取所有已加载的插件
   */
  getPlugins(): INetworkPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 根据名称获取插件
   */
  getPlugin(name: string): INetworkPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * 检查插件是否已加载
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * 卸载所有插件
   */
  async unloadAll(): Promise<void> {
    const pluginNames = Array.from(this.plugins.keys());

    for (const name of pluginNames) {
      await this.unloadPlugin(name);
    }
  }

  /**
   * 获取插件数量
   */
  getPluginCount(): number {
    return this.plugins.size;
  }
}
