/**
 * 缓存存储接口
 * @description 定义缓存存储操作，支持自动过期、容量管理
 * 
 * ## 适用场景
 * - 分析结果缓存（带过期时间）
 * - 临时数据、会话数据
 * - 网络请求缓存
 * 
 * ## 环境选择
 * - **跨平台**：MemoryAdapter（默认 50MB）
 * - **浏览器**：LocalStorageAdapter（容量小）
 * 
 * ## 使用示例
 * ```typescript
 * import { MemoryAdapter } from './infrastructure/storage';
 * 
 * const cache = new MemoryAdapter({ maxSize: 50 * 1024 * 1024 });
 * await cache.initialize();
 * 
 * // 写入缓存（5分钟后过期）
 * await cache.set('analysis-result', { score: 0.85 }, 5 * 60 * 1000);
 * 
 * // 读取缓存
 * const result = await cache.get<{ score: number }>('analysis-result');
 * ```
 */

/**
 * 缓存项元数据
 */
export interface ICacheItem<T> {
  /** 缓存数据 */
  data: T;

  /** 过期时间戳（毫秒），null 表示永不过期 */
  expiresAt: number | null;

  /** 创建时间戳 */
  createdAt: number;

  /** 最后访问时间戳 */
  lastAccessedAt: number;
}

/**
 * 缓存存储接口
 * @description 提供缓存数据的存取、过期管理、容量管理能力
 */
export interface ICacheStorage {
  /**
   * 读取缓存
   * @param key - 缓存键
   * @returns 缓存数据，不存在或已过期返回 null
   * @ai-example
   * const data = await cache.get<{ name: string }>('user-data');
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * 写入缓存
   * @param key - 缓存键
   * @param data - 缓存数据
   * @param ttl - 存活时间（毫秒），可选，不传则永不过期
   * @ai-example
   * await cache.set('user-data', { name: 'Alice' }, 300000); // 5分钟
   */
  set<T>(key: string, data: T, ttl?: number): Promise<void>;

  /**
   * 删除缓存
   * @param key - 缓存键
   * @ai-example
   * await cache.delete('user-data');
   */
  delete(key: string): Promise<void>;

  /**
   * 检查缓存是否存在
   * @param key - 缓存键
   * @returns 是否存在（已过期返回 false）
   * @ai-example
   * const exists = await cache.has('user-data');
   */
  has(key: string): Promise<boolean>;

  /**
   * 检查缓存是否过期
   * @param key - 缓存键
   * @returns 是否过期（不存在返回 true）
   * @ai-example
   * const expired = await cache.isExpired('user-data');
   */
  isExpired(key: string): Promise<boolean>;

  /**
   * 清空所有缓存
   * @ai-example
   * await cache.clear();
   */
  clear(): Promise<void>;

  /**
   * 获取缓存数量
   * @returns 缓存项数量
   * @ai-example
   * const count = await cache.size();
   */
  size(): Promise<number>;

  /**
   * 获取缓存大小（字节）
   * @returns 缓存大小（近似值）
   * @ai-example
   * const bytes = await cache.getSize();
   */
  getSize(): Promise<number>;

  /**
   * 清理过期缓存
   * @returns 清理的缓存项数量
   * @ai-example
   * const cleaned = await cache.cleanup();
   */
  cleanup(): Promise<number>;

  /**
   * 获取所有缓存键
   * @returns 缓存键列表
   * @ai-example
   * const keys = await cache.keys();
   */
  keys(): Promise<string[]>;

  /**
   * 获取缓存项元数据
   * @param key - 缓存键
   * @returns 缓存项元数据，不存在返回 null
   * @ai-example
   * const meta = await cache.getMetadata('user-data');
   */
  getMetadata<T>(key: string): Promise<ICacheItem<T> | null>;
}

/**
 * 缓存存储适配器接口
 * @description 扩展 ICacheStorage，增加适配器管理能力
 */
export interface ICacheStorageAdapter extends ICacheStorage {
  /**
   * 适配器名称
   */
  readonly name: string;

  /**
   * 适配器类型
   */
  readonly type: CacheAdapterType;

  /**
   * 初始化适配器
   */
  initialize(): Promise<void>;

  /**
   * 销毁适配器
   */
  destroy(): Promise<void>;

  /**
   * 检查适配器是否可用
   */
  isAvailable(): boolean;
}

/**
 * 缓存适配器类型枚举
 */
export enum CacheAdapterType {
  Memory = 'memory',
  LocalStorage = 'localStorage',
  IndexedDB = 'indexedDB',
  CacheAPI = 'cacheAPI',
}
