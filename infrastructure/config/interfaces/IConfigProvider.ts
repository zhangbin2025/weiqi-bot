/**
 * 配置提供者接口
 * @description 提供配置的读取、写入、监听等操作
 */

import type {
  ConfigChangeListener,
  ConfigKey,
  ConfigNamespace,
} from './types';

/**
 * 配置提供者接口
 * @description 统一的配置访问接口
 * @ai-example
 * const config = await configProvider.getModuleConfig<IStorageConfig>('storage');
 */
export interface IConfigProvider {
  /**
   * 获取配置值
   * @param key - 配置键
   * @returns 配置值，不存在返回 undefined
   * @ai-example
   * const timeout = await configProvider.get<number>('network.timeout');
   */
  get<T>(key: ConfigKey): Promise<T | undefined>;

  /**
   * 设置配置值
   * @param key - 配置键
   * @param value - 配置值
   * @ai-example
   * await configProvider.set('storage.namespace', 'my-app');
   */
  set<T>(key: ConfigKey, value: T): Promise<void>;

  /**
   * 获取模块配置
   * @param module - 模块名
   * @returns 模块配置对象
   * @ai-example
   * const config = await configProvider.getModuleConfig<IStorageConfig>('storage');
   */
  getModuleConfig<T>(module: ConfigNamespace): Promise<T>;

  /**
   * 设置模块配置
   * @param module - 模块名
   * @param config - 配置对象
   * @ai-example
   * await configProvider.setModuleConfig('storage', { namespace: 'my-app' });
   */
  setModuleConfig<T>(module: ConfigNamespace, config: Partial<T>): Promise<void>;

  /**
   * 监听配置变更
   * @param key - 配置键
   * @param callback - 变更回调
   * @returns 取消监听函数
   * @ai-example
   * const unsubscribe = configProvider.onChange('storage.namespace', (value) => {
   *   console.log('Namespace changed:', value);
   * });
   * unsubscribe(); // 取消监听
   */
  onChange<T>(key: ConfigKey, callback: ConfigChangeListener<T>): () => void;

  /**
   * 重置配置为默认值
   * @param key - 配置键（可选，不传则重置所有）
   * @ai-example
   * await configProvider.reset('storage.namespace'); // 重置单个配置
   * await configProvider.reset(); // 重置所有配置
   */
  reset(key?: ConfigKey): Promise<void>;

  /**
   * 检查配置是否存在
   * @param key - 配置键
   * @returns 是否存在
   * @ai-example
   * const exists = await configProvider.has('storage.namespace');
   */
  has(key: ConfigKey): Promise<boolean>;

  /**
   * 删除配置
   * @param key - 配置键
   * @ai-example
   * await configProvider.delete('storage.namespace');
   */
  delete(key: ConfigKey): Promise<void>;

  /**
   * 注册配置 schema
   * @param namespace - 配置命名空间
   * @param schema - 配置 schema
   */
  registerSchema(namespace: ConfigNamespace, schema: unknown): void;
}
