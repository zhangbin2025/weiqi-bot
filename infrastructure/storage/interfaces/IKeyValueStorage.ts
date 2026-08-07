/**
 * 键值存储接口
 * @description 定义简单的键值对存储操作，适用于小型配置、标识符映射等场景
 * 
 * ## 适用场景
 * - 用户设置、主题配置
 * - 简单的数据缓存
 * - 标识符映射
 * 
 * ## 环境选择
 * - **浏览器**：LocalStorageAdapter（容量 ~5MB）
 * - **Node.js**：JsonFileAdapter（持久化）
 * 
 * ## 使用示例
 * ```typescript
 * import { LocalStorageAdapter } from './infrastructure/storage';
 * 
 * const storage = new LocalStorageAdapter('my-app');
 * await storage.initialize();
 * 
 * // 写入数据
 * await storage.write('user-config', { theme: 'dark', fontSize: 14 });
 * 
 * // 读取数据
 * const config = await storage.read<{ theme: string; fontSize: number }>('user-config');
 * 
 * // 删除数据
 * await storage.delete('user-config');
 * ```
 */
export interface IKeyValueStorage {
  /**
   * 读取数据
   * @param key - 数据键
   * @returns 数据内容，不存在返回 null
   * @ai-example
   * const data = await storage.read<{ theme: string }>('user-config');
   * // data = { theme: 'dark' } 或 null
   */
  read<T>(key: string): Promise<T | null>;

  /**
   * 写入数据
   * @param key - 数据键
   * @param data - 数据内容
   * @ai-example
   * await storage.write('user-config', { theme: 'light' });
   */
  write<T>(key: string, data: T): Promise<void>;

  /**
   * 删除数据
   * @param key - 数据键
   * @ai-example
   * await storage.delete('user-config');
   */
  delete(key: string): Promise<void>;

  /**
   * 检查数据是否存在
   * @param key - 数据键
   * @returns 是否存在
   * @ai-example
   * const exists = await storage.exists('user-config');
   * // exists = true 或 false
   */
  exists(key: string): Promise<boolean>;

  /**
   * 列出所有键
   * @param pattern - 键模式（可选），支持通配符 * 和 ?
   * @returns 匹配的键列表
   * @ai-example
   * const keys = await storage.listKeys('user-*');
   * // keys = ['user-config', 'user-preferences']
   */
  listKeys(pattern?: string): Promise<string[]>;

  /**
   * 清空所有数据
   * @ai-example
   * await storage.clear();
   */
  clear(): Promise<void>;
  initialize(): Promise<void>;

}

/**
 * 键值存储适配器接口
 * @description 扩展 IKeyValueStorage，增加适配器管理能力
 */
export interface IKeyValueStorageAdapter extends IKeyValueStorage {
  /**
   * 适配器名称
   */
  readonly name: string;

  /**
   * 适配器类型
   */
  readonly type: StorageAdapterType;

  /**
   * 初始化适配器
   * @description 在使用前必须调用此方法
   */
  initialize(): Promise<void>;

  /**
   * 销毁适配器
   * @description 释放资源，清理数据
   */
  destroy(): Promise<void>;

  /**
   * 检查适配器是否可用
   * @returns 是否可用
   */
  isAvailable(): boolean;
}

/**
 * 存储适配器类型枚举
 */
export enum StorageAdapterType {
  LocalStorage = 'localStorage',
  SessionStorage = 'sessionStorage',
  IndexedDB = 'indexedDB',
  Memory = 'memory',
  JsonFile = 'jsonFile',
  RemoteAPI = 'remoteAPI',
}
