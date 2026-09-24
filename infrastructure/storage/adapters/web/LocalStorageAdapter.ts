import {
  IKeyValueStorageAdapter,
  StorageAdapterType,
} from '../../interfaces/IKeyValueStorage';

/**
 * LocalStorage 存储适配器
 * @description 使用浏览器 localStorage 实现键值存储
 * @limitations
 * - 存储容量限制：~5MB
 * - 仅支持字符串，自动 JSON 序列化/反序列化
 * - 同步操作，但包装为 Promise 以统一接口
 * @ai-example
 * const adapter = new LocalStorageAdapter('my-app');
 * await adapter.initialize();
 * await adapter.write('key', { value: 123 });
 * const data = await adapter.read('key');
 */
export class LocalStorageAdapter implements IKeyValueStorageAdapter {
  readonly name: string;
  readonly type = StorageAdapterType.LocalStorage;

  /**
   * @param namespace - 命名空间，用于隔离不同应用的数据。
   *                    省略时使用裸键（不加前缀、不 JSON 序列化），
   *                    以便与其他直接读写 localStorage 的模块共享数据。
   */
  constructor(private readonly namespace?: string) {
    this.name = `localStorage:${namespace}`;
  }

  /**
   * 初始化适配器
   * @description 检查 localStorage 是否可用
   */
  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('localStorage is not available');
    }
  }

  /**
   * 销毁适配器
   */
  async destroy(): Promise<void> {
    // LocalStorage 无需特殊清理
  }

  /**
   * 检查 localStorage 是否可用
   */
  isAvailable(): boolean {
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, testKey);
      localStorage.removeItem(testKey);
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
    const data = localStorage.getItem(fullKey);

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
   * 同步读取数据
   * @description localStorage 本身是同步 API，封装层默认走 async 仅为统一接口。
   *              隧道配置需要在同步上下文（如 createAIEngine 工厂）里即时读取，
   *              故提供同步版本，绕开 async 包装，行为与 read() 一致。
   */
  readSync<T>(key: string): T | null {
    if (!this.isAvailable()) {
      return null;
    }
    const fullKey = this.getFullKey(key);
    const data = localStorage.getItem(fullKey);
    if (data === null) {
      return null;
    }
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  /**
   * 写入数据
   */
  async write<T>(key: string, data: T): Promise<void> {
    const fullKey = this.getFullKey(key);
    // 不指定 namespace 时，按原始字符串写入（不 JSON 序列化），
    // 以兼容直接读写 localStorage 裸键的场景（如 KataGo 调试开关）。
    const serialized = this.namespace === undefined ? String(data) : JSON.stringify(data);
    localStorage.setItem(fullKey, serialized);
  }

  /**
   * 删除数据
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    localStorage.removeItem(fullKey);
  }

  /**
   * 检查数据是否存在
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    return localStorage.getItem(fullKey) !== null;
  }

  /**
   * 列出所有键
   */
  async listKeys(pattern?: string): Promise<string[]> {
    const keys: string[] = [];
    // 不指定 namespace 时，prefix 为空字符串，匹配所有键；
    // 否则使用 namespace: 作为前缀。
    const prefix = this.namespace === undefined ? '' : `${this.namespace}:`;

    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i);
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
    return this.namespace === undefined ? key : `${this.namespace}:${key}`;
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
