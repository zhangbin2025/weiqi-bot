/**
 * 配置存储接口
 * @description 对接 storage 模块，提供配置持久化能力
 */

import type { ConfigNamespace, ConfigObject } from './types';

/**
 * 配置存储接口
 * @description 提供配置的持久化存储能力
 * @ai-example
 * const config = await configStorage.load('storage');
 */
export interface IConfigStorage {
  /**
   * 加载配置
   * @param namespace - 命名空间
   * @returns 配置对象
   * @ai-example
   * const config = await configStorage.load('storage');
   */
  load(namespace: ConfigNamespace): Promise<ConfigObject>;

  /**
   * 保存配置
   * @param namespace - 命名空间
   * @param config - 配置对象
   * @ai-example
   * await configStorage.save('storage', { namespace: 'my-app' });
   */
  save(namespace: ConfigNamespace, config: ConfigObject): Promise<void>;

  /**
   * 删除配置
   * @param namespace - 命名空间
   * @param key - 配置键（可选）
   * @ai-example
   * await configStorage.delete('storage'); // 删除整个命名空间
   * await configStorage.delete('storage', 'namespace'); // 删除单个配置
   */
  delete(namespace: ConfigNamespace, key?: string): Promise<void>;

  /**
   * 检查配置是否存在
   * @param namespace - 命名空间
   * @param key - 配置键（可选）
   * @returns 是否存在
   * @ai-example
   * const exists = await configStorage.has('storage', 'namespace');
   */
  has(namespace: ConfigNamespace, key?: string): Promise<boolean>;

  /**
   * 导出所有配置
   * @returns JSON 字符串
   * @ai-example
   * const json = await configStorage.export();
   */
  export(): Promise<string>;

  /**
   * 导入配置
   * @param json - JSON 字符串
   * @ai-example
   * await configStorage.import(jsonString);
   */
  import(json: string): Promise<void>;

  /**
   * 清空所有配置
   * @ai-example
   * await configStorage.clear();
   */
  clear(): Promise<void>;
}
