/**
 * 网络插件接口
 * @description 定义网络插件的接口，支持动态加载和注册
 * @ai-example
 * class CustomPlugin implements INetworkPlugin {
 *   name = 'custom-provider';
 *   version = '1.0.0';
 *   register(registry) { registry.register(new CustomProvider()); }
 * }
 */

import type { IProviderRegistry } from './IProviderRegistry';

/**
 * 网络插件接口
 */
export interface INetworkPlugin {
  /** 插件名称（唯一标识） */
  readonly name: string;

  /** 插件版本 */
  readonly version: string;

  /** 插件依赖 */
  readonly dependencies?: string[];

  /**
   * 注册网络提供者
   * @param registry - 提供者注册表
   * @ai-example
   * register(registry) {
   *   registry.register(new CustomProvider());
   * }
   */
  register(registry: IProviderRegistry): void;

  /**
   * 初始化插件（可选）
   */
  initialize?(): Promise<void>;

  /**
   * 销毁插件（可选）
   */
  destroy?(): Promise<void>;
}

/**
 * 插件管理器接口
 */
export interface IPluginManager {
  /**
   * 加载插件
   * @param plugin - 插件实例
   * @ai-example
   * await pluginManager.loadPlugin(new CustomPlugin());
   */
  loadPlugin(plugin: INetworkPlugin): Promise<void>;

  /**
   * 卸载插件
   * @param name - 插件名称
   */
  unloadPlugin(name: string): Promise<void>;

  /**
   * 获取所有已加载的插件
   * @returns 插件列表
   */
  getPlugins(): INetworkPlugin[];

  /**
   * 根据名称获取插件
   * @param name - 插件名称
   * @returns 插件实例（如果存在）
   */
  getPlugin(name: string): INetworkPlugin | undefined;

  /**
   * 检查插件是否已加载
   * @param name - 插件名称
   * @returns 是否已加载
   */
  hasPlugin(name: string): boolean;

  /**
   * 卸载所有插件
   */
  unloadAll(): Promise<void>;
}

/**
 * 插件配置
 */
export interface IPluginConfig {
  /** 插件名称 */
  name: string;

  /** 插件路径（用于动态加载） */
  path?: string;

  /** 插件版本 */
  version?: string;

  /** 插件配置 */
  config?: Record<string, unknown>;

  /** 是否自动初始化 */
  autoInitialize?: boolean;
}
