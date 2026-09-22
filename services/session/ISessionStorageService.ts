/**
 * SessionStorage 服务接口
 * @description 提供会话级键值存储
 */

export interface ISessionStorageService {
  /**
   * 获取数据
   * @param key - 数据键
   * @returns 数据内容，不存在返回 null
   * @ai-example
   * const data = await sessionStorageService.get<{ name: string }>('user-data');
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * 设置数据
   * @param key - 数据键
   * @param value - 数据内容
   * @ai-example
   * await sessionStorageService.set('user-data', { name: 'Alice' });
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * 删除数据
   * @param key - 数据键
   * @ai-example
   * await sessionStorageService.remove('user-data');
   */
  remove(key: string): Promise<void>;

  /**
   * 检查是否存在
   * @param key - 数据键
   * @returns 是否存在
   * @ai-example
   * const exists = await sessionStorageService.has('user-data');
   */
  has(key: string): Promise<boolean>;

  /**
   * 列出所有键
   * @param pattern - 可选通配模式（支持 * 和 ?）
   * @ai-example
   * const keys = await sessionStorageService.listKeys();
   */
  listKeys(pattern?: string): Promise<string[]>;

  /**
   * 清空所有数据
   * @ai-example
   * await sessionStorageService.clear();
   */
  clear(): Promise<void>;
}
