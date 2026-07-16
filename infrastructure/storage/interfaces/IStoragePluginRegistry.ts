import { IKeyValueStorageAdapter } from './IKeyValueStorage';

/**
 * 存储插件注册器接口
 * @description 管理存储适配器的注册、注销和查找
 * @ai-example
 * const registry = new StoragePluginRegistry();
 * registry.register(adapter);
 * const adapter = registry.get('localStorage:my-app');
 */
export interface IStoragePluginRegistry {
  /**
   * 注册存储适配器
   * @param adapter - 存储适配器实例
   * @throws 如果适配器名称已存在
   * @ai-example
   * registry.register(new LocalStorageAdapter('my-app'));
   */
  register(adapter: IKeyValueStorageAdapter): void;

  /**
   * 注销存储适配器
   * @param name - 适配器名称
   * @ai-example
   * registry.unregister('localStorage:my-app');
   */
  unregister(name: string): void;

  /**
   * 获取存储适配器
   * @param name - 适配器名称
   * @returns 适配器实例，不存在返回 undefined
   * @ai-example
   * const adapter = registry.get('localStorage:my-app');
   */
  get(name: string): IKeyValueStorageAdapter | undefined;

  /**
   * 检查适配器是否已注册
   * @param name - 适配器名称
   * @returns 是否存在
   * @ai-example
   * const exists = registry.has('localStorage:my-app');
   */
  has(name: string): boolean;

  /**
   * 列出所有已注册的适配器
   * @returns 所有适配器实例
   * @ai-example
   * const adapters = registry.listAll();
   */
  listAll(): IKeyValueStorageAdapter[];

  /**
   * 按类型查找适配器
   * @param type - 适配器类型
   * @returns 匹配的适配器列表
   * @ai-example
   * const adapters = registry.findByType(StorageAdapterType.LocalStorage);
   */
  findByType(type: string): IKeyValueStorageAdapter[];

  /**
   * 清空所有已注册的适配器
   * @ai-example
   * registry.clear();
   */
  clear(): void;
}

/**
 * 存储插件描述信息
 * @description 描述一个可动态加载的存储插件
 */
export interface IStoragePluginDescriptor {
  /** 插件名称 */
  name: string;

  /** 插件版本 */
  version: string;

  /** 插件描述 */
  description?: string;

  /** 插件加载路径（模块路径或 URL） */
  path: string;

  /** 插件依赖 */
  dependencies?: string[];
}

/**
 * 存储插件加载器接口
 * @description 动态加载存储插件
 */
export interface IStoragePluginLoader {
  /**
   * 加载插件
   * @param descriptor - 插件描述信息
   * @returns 适配器实例
   * @ai-example
   * const adapter = await loader.load({
   *   name: 'custom-storage',
   *   version: '1.0.0',
   *   path: './plugins/custom-storage'
   * });
   */
  load(descriptor: IStoragePluginDescriptor): Promise<IKeyValueStorageAdapter>;

  /**
   * 检查插件是否可用
   * @param path - 插件路径
   * @returns 是否可用
   */
  isAvailable(path: string): Promise<boolean>;
}
