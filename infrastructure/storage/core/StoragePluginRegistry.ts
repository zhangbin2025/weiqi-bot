import {
  IStoragePluginRegistry,
  IStoragePluginDescriptor,
  IStoragePluginLoader,
} from '../interfaces/IStoragePluginRegistry';
import {
  IKeyValueStorageAdapter,
  StorageAdapterType,
} from '../interfaces/IKeyValueStorage';

/**
 * 存储插件注册器
 * @description 管理存储适配器的注册、注销和查找
 */
export class StoragePluginRegistry implements IStoragePluginRegistry {
  private adapters = new Map<string, IKeyValueStorageAdapter>();

  /**
   * 注册存储适配器
   */
  register(adapter: IKeyValueStorageAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Adapter "${adapter.name}" already registered`);
    }
    this.adapters.set(adapter.name, adapter);
  }

  /**
   * 注销存储适配器
   */
  unregister(name: string): void {
    this.adapters.delete(name);
  }

  /**
   * 获取存储适配器
   */
  get(name: string): IKeyValueStorageAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * 检查适配器是否已注册
   */
  has(name: string): boolean {
    return this.adapters.has(name);
  }

  /**
   * 列出所有已注册的适配器
   */
  listAll(): IKeyValueStorageAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * 按类型查找适配器
   */
  findByType(type: string): IKeyValueStorageAdapter[] {
    return this.listAll().filter((adapter) => adapter.type === type);
  }

  /**
   * 清空所有已注册的适配器
   */
  clear(): void {
    this.adapters.clear();
  }
}

/**
 * 存储插件加载器
 * @description 支持动态 import() 加载插件
 */
export class StoragePluginLoader implements IStoragePluginLoader {
  /**
   * 加载插件
   * @description 使用动态 import() 加载插件模块
   */
  async load(
    descriptor: IStoragePluginDescriptor
  ): Promise<IKeyValueStorageAdapter> {
    try {
      // 动态导入插件模块
      const module = await import(descriptor.path);

      // 检查模块是否导出了适配器工厂函数或类
      if (module.createAdapter && typeof module.createAdapter === 'function') {
        // 如果导出的是工厂函数
        return await module.createAdapter();
      } else if (module.default && typeof module.default === 'function') {
        // 如果导出的是默认类
        return new module.default();
      } else {
        throw new Error(
          `Plugin "${descriptor.name}" must export createAdapter function or default class`
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to load plugin "${descriptor.name}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 检查插件是否可用
   */
  async isAvailable(path: string): Promise<boolean> {
    try {
      await import(path);
      return true;
    } catch {
      return false;
    }
  }
}
