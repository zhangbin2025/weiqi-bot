/**
 * 文档存储接口
 * @description 定义结构化文档的存储操作，支持查询、排序、分页
 * 
 * ## 适用场景
 * - 结构化数据（棋手信息、比赛数据）
 * - 需要查询、排序、分页的数据
 * 
 * ## 环境选择
 * - **浏览器**：IndexedDBAdapter（容量 50-500MB）
 * - **Node.js**：JsonFileAdapter（持久化）
 * 
 * ## 使用示例
 * ```typescript
 * import { IndexedDBAdapter } from './infrastructure/storage';
 * 
 * interface Player { id: string; name: string; rank: string }
 * 
 * const storage = new IndexedDBAdapter<Player>('weiqi', 'players');
 * await storage.initialize();
 * 
 * await storage.insert({ id: '1', name: '柯洁', rank: '九段' });
 * const players = await storage.find({ where: { rank: '九段' } });
 * ```
 */

/** 查询条件 */
export interface QueryCriteria {
  /** 字段过滤条件 */
  where?: Record<string, unknown> | undefined;
  /** 排序字段 */
  orderBy?: string | undefined;
  /** 排序方向 */
  orderDirection?: 'asc' | 'desc' | undefined;
  /** 限制数量 */
  limit?: number | undefined;
  /** 偏移量（用于分页） */
  offset?: number | undefined;
}

/** 文档存储接口 */
export interface IDocumentStorage<T extends { id: string }> {
  /** 插入文档 */
  insert(doc: T): Promise<string>;
  /** 批量插入文档 */
  insertMany(docs: T[]): Promise<string[]>;
  /** 更新文档 */
  update(id: string, doc: Partial<T>): Promise<void>;
  /** 删除文档 */
  delete(id: string): Promise<void>;
  /** 批量删除文档 */
  deleteMany(ids: string[]): Promise<void>;
  /** 按 ID 查询文档 */
  findById(id: string): Promise<T | null>;
  /** 按条件查询文档 */
  find(criteria?: QueryCriteria): Promise<T[]>;
  /** 查询第一个匹配的文档 */
  findOne(criteria?: QueryCriteria): Promise<T | null>;
  /** 统计文档数量 */
  count(criteria?: QueryCriteria): Promise<number>;
  /** 检查文档是否存在 */
  exists(id: string): Promise<boolean>;
  /** 清空所有文档 */
  clear(): Promise<void>;
  /** 初始化存储 */
  initialize(): Promise<void>;
}

/** 文档存储适配器接口 */
export interface IDocumentStorageAdapter<T extends { id: string }>
  extends IDocumentStorage<T> {
  /** 适配器名称 */
  readonly name: string;
  /** 适配器类型 */
  readonly type: StorageAdapterType;
  /** 初始化适配器 */
  initialize(): Promise<void>;
  /** 销毁适配器 */
  destroy(): Promise<void>;
  /** 检查适配器是否可用 */
  isAvailable(): boolean;
}

/** 存储适配器类型枚举 */
export enum StorageAdapterType {
  LocalStorage = 'localStorage',
  SessionStorage = 'sessionStorage',
  IndexedDB = 'indexedDB',
  Memory = 'memory',
  JsonFile = 'jsonFile',
  RemoteAPI = 'remoteAPI',
}
