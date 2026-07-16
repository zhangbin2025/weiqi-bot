/**
 * 配置存储适配器
 * @description 对接 storage 模块的 IKeyValueStorage，提供配置持久化能力
 */

import type { IConfigStorage } from '../interfaces';
import type { IKeyValueStorage } from '../../storage/interfaces/IKeyValueStorage';
import type { ConfigNamespace, ConfigObject } from '../interfaces';

/**
 * 配置存储适配器
 * @description 对接 storage 模块的 IKeyValueStorage
 */
export class ConfigStorageAdapter implements IConfigStorage {
  private storage: IKeyValueStorage;
  private prefix: string;

  /**
   * 创建配置存储适配器
   * @param storage - 键值存储实例
   * @param prefix - 配置键前缀
   */
  constructor(storage: IKeyValueStorage, prefix: string = 'config') {
    this.storage = storage;
    this.prefix = prefix;
  }

  /**
   * 生成配置键
   * @param namespace - 命名空间
   * @param key - 配置键（可选）
   */
  private buildKey(namespace: ConfigNamespace, key?: string): string {
    const baseKey = `${this.prefix}:${namespace}`;
    return key ? `${baseKey}:${key}` : baseKey;
  }

  /**
   * 加载配置
   */
  async load(namespace: ConfigNamespace): Promise<ConfigObject> {
    const key = this.buildKey(namespace);
    const config = await this.storage.read<ConfigObject>(key);
    return config || {};
  }

  /**
   * 保存配置
   */
  async save(namespace: ConfigNamespace, config: ConfigObject): Promise<void> {
    const key = this.buildKey(namespace);
    await this.storage.write(key, config);
  }

  /**
   * 删除配置
   */
  async delete(namespace: ConfigNamespace, key?: string): Promise<void> {
    if (key) {
      // 删除单个配置项
      const configKey = this.buildKey(namespace, key);
      await this.storage.delete(configKey);
    } else {
      // 删除整个命名空间
      const configKey = this.buildKey(namespace);
      await this.storage.delete(configKey);
    }
  }

  /**
   * 检查配置是否存在
   */
  async has(namespace: ConfigNamespace, key?: string): Promise<boolean> {
    const configKey = this.buildKey(namespace, key);
    return this.storage.exists(configKey);
  }

  /**
   * 导出所有配置
   */
  async export(): Promise<string> {
    const allKeys = await this.storage.listKeys(`${this.prefix}:*`);
    const configs: Record<string, ConfigObject> = {};

    for (const key of allKeys) {
      const config = await this.storage.read<ConfigObject>(key);
      if (config) {
        configs[key] = config;
      }
    }

    return JSON.stringify(configs, null, 2);
  }

  /**
   * 导入配置
   */
  async import(json: string): Promise<void> {
    const configs: Record<string, ConfigObject> = JSON.parse(json);

    for (const [key, config] of Object.entries(configs)) {
      await this.storage.write(key, config);
    }
  }

  /**
   * 清空所有配置
   */
  async clear(): Promise<void> {
    const allKeys = await this.storage.listKeys(`${this.prefix}:*`);

    for (const key of allKeys) {
      await this.storage.delete(key);
    }
  }
}
