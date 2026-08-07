import {
  IKeyValueStorageAdapter,
  StorageAdapterType,
} from '../../interfaces/IKeyValueStorage';

/**
 * SessionStorage 存储适配器
 * @description 使用浏览器 sessionStorage 实现键值存储
 * @limitations
 * - 存储容量限制：~5MB
 * - 仅支持字符串，自动 JSON 序列化/反序列化
 * - 会话期间有效，关闭标签页后数据清除
 * - 同步操作，但包装为 Promise 以统一接口
 * @ai-example
 * const adapter = new SessionStorageAdapter('my-app');
 * await adapter.initialize();
 * await adapter.write('key', { value: 123 });
 * const data = await adapter.read('key');
 */
export class SessionStorageAdapter implements IKeyValueStorageAdapter {
  readonly name: string;
  readonly type = StorageAdapterType.SessionStorage;

  /**
   * @param namespace - 命名空间，用于隔离不同应用的数据
   */
  constructor(private readonly namespace: string) {
    this.name = `sessionStorage:${namespace}`;
  }

  /**
   * 初始化适配器
   * @description 检查 sessionStorage 是否可用
   */
  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('sessionStorage is not available');
    }
  }

  /**
   * 销毁适配器
   */
  async destroy(): Promise<void> {
    // SessionStorage 无需特殊清理
  }

  /**
   * 检查 sessionStorage 是否可用
   */
  isAvailable(): boolean {
    try {
      const testKey = '__storage_test__';
      sessionStorage.setItem(testKey, testKey);
      sessionStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 读取数据
   */
  async read<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);
    const data = sessionStorage.getItem(fullKey);

    if (data === null) {
      return null;
    }

    try {
      return JSON.parse(data) as T;
    } catch {
      // 如果解析失败，返回原始字符串
      return data as unknown as T;
    }
  }

  /**
   * 写入数据
   */
  async write<T>(key: string, data: T): Promise<void> {
    const fullKey = this.getFullKey(key);
    const serialized = JSON.stringify(data);
    sessionStorage.setItem(fullKey, serialized);
  }

  /**
   * 删除数据
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    sessionStorage.removeItem(fullKey);
  }

  /**
   * 检查数据是否存在
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    return sessionStorage.getItem(fullKey) !== null;
  }

  /**
   * 列出所有键
   */
  async listKeys(pattern?: string): Promise<string[]> {
    const keys: string[] = [];
    const prefix = `${this.namespace}:`;

    for (let i = 0; i < sessionStorage.length; i++) {
      const fullKey = sessionStorage.key(i);
      if (fullKey && fullKey.startsWith(prefix)) {
        const key = fullKey.substring(prefix.length);

        if (pattern) {
          if (this.matchPattern(key, pattern)) {
            keys.push(key);
          }
        } else {
          keys.push(key);
        }
      }
    }

    return keys;
  }

  /**
   * 清空所有数据
   */
  async clear(): Promise<void> {
    const keys = await this.listKeys();
    for (const key of keys) {
      await this.delete(key);
    }
  }

  /**
   * 获取完整键名（带命名空间）
   */
  private getFullKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  /**
   * 简单的模式匹配
   * @description 支持 * 和 ? 通配符
   */
  private matchPattern(text: string, pattern: string): boolean {
    // 先转义特殊字符，然后替换通配符
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // 先转义特殊字符
      .replace(/\*/g, '.*')                     // 替换 * 为 .*
      .replace(/\?/g, '.');                     // 替换 ? 为 .
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
  }
}
