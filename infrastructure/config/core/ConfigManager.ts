/**
 * 配置管理器
 */

import type { IConfigProvider, IConfigStorage, IConfigSchemaDefinition, ConfigObject, ConfigKey, ConfigChangeListener } from '../interfaces';
import { ConfigHelper } from './ConfigHelper';
import { ConfigNotifier } from './ConfigNotifier';

export class ConfigManager implements IConfigProvider {
  private storage: IConfigStorage;
  private schemas: Map<string, IConfigSchemaDefinition<unknown>>;
  private configs: Map<string, ConfigObject>;
  private notifier: ConfigNotifier;

  constructor(storage: IConfigStorage) {
    this.storage = storage;
    this.schemas = new Map();
    this.configs = new Map();
    this.notifier = new ConfigNotifier();
  }

  registerSchema<T>(module: string, schema: IConfigSchemaDefinition<T>): void {
    if (this.schemas.has(module)) {
      throw new Error(`Config schema for module '${module}' already registered`);
    }
    this.schemas.set(module, schema as IConfigSchemaDefinition<unknown>);
  }

  async get<T>(key: ConfigKey): Promise<T | undefined> {
    const parts = key.split('.');
    const module = parts[0]!;
    const path = parts.slice(1);
    const config = await this.getModuleConfig<T>(module);
    if (path.length === 0) return config;
    return ConfigHelper.getNestedValue(config as ConfigObject, path.join('.')) as T;
  }

  async set<T>(key: ConfigKey, value: T): Promise<void> {
    const parts = key.split('.');
    const module = parts[0]!;
    const path = parts.slice(1);
    if (path.length === 0) {
      await this.setModuleConfig(module, value as ConfigObject);
      return;
    }
    const config = await this.getModuleConfig<Record<string, unknown>>(module);
    let current = config;
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i]!;
      if (!(p in current)) current[p] = {};
      current = current[p] as Record<string, unknown>;
    }
    current[path[path.length - 1]!] = value;
    await this.setModuleConfig(module, config);
  }

  async getModuleConfig<T>(module: string): Promise<T> {
    const cached = this.configs.get(module);
    if (cached) return cached as T;
    const storedConfig = await this.storage.load(module);
    const schema = this.schemas.get(module);
    const defaultConfig = schema ? ConfigHelper.getDefaultConfig(schema) : {};
    const mergedConfig = ConfigHelper.mergeConfigs(defaultConfig, storedConfig);
    this.configs.set(module, mergedConfig);
    return mergedConfig as T;
  }

  async setModuleConfig<T>(module: string, config: Partial<T>): Promise<void> {
    const currentConfig = await this.getModuleConfig<T>(module);
    const mergedConfig = ConfigHelper.mergeConfigs(currentConfig as ConfigObject, config as ConfigObject);
    await this.storage.save(module, mergedConfig);
    this.configs.set(module, mergedConfig);
    this.notifier.notify(module, mergedConfig);
  }

  onChange<T>(key: ConfigKey, callback: ConfigChangeListener<T>): () => void {
    return this.notifier.subscribe(key, callback as ConfigChangeListener);
  }

  async reset(key?: ConfigKey): Promise<void> {
    if (!key) {
      for (const module of this.schemas.keys()) {
        await this.storage.delete(module);
        this.configs.delete(module);
      }
      return;
    }
    const parts = key.split('.');
    const module = parts[0]!;
    const rest = parts.slice(1);
    if (rest.length > 0) {
      const schema = this.schemas.get(module);
      if (schema) {
        const defaultConfig = ConfigHelper.getDefaultConfig(schema);
        const subKey = rest[0]!;
        const defaultVal = (defaultConfig as Record<string, unknown>)[subKey];
        if (defaultVal !== undefined) {
          await this.set(key, defaultVal);
        }
      }
    } else {
      await this.storage.delete(module);
      this.configs.delete(module);
    }
  }

  async has(key: ConfigKey): Promise<boolean> {
    const module = key.split('.')[0]!;
    return this.storage.has(module);
  }

  async delete(key: ConfigKey): Promise<void> {
    const module = key.split('.')[0]!;
    await this.storage.delete(module);
    this.configs.delete(module);
  }
}
