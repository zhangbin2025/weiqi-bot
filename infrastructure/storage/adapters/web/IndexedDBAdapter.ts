import {
  IDocumentStorageAdapter,
  QueryCriteria,
  StorageAdapterType,
} from '../../interfaces/IDocumentStorage';
import {
  openDatabase,
  getObjectStore,
  promisifyRequest,
  promisifyTransaction,
  matchWhere,
  sortDocuments,
  paginateDocuments,
} from './IndexedDBHelper';

/**
 * IndexedDB 存储适配器
 * @description 使用浏览器 IndexedDB 实现文档存储
 * @limitations
 * - 存储容量限制：~50MB-500MB（浏览器差异）
 * - 仅支持浏览器环境
 * @ai-example
 * interface User { id: string; name: string }
 * const adapter = new IndexedDBAdapter<User>('my-db', 'users');
 * await adapter.initialize();
 * await adapter.insert({ id: '1', name: 'Alice' });
 */
export class IndexedDBAdapter<T extends { id: string }>
  implements IDocumentStorageAdapter<T> {
  readonly name: string;
  readonly type = StorageAdapterType.IndexedDB;
  private db: IDBDatabase | null = null;

  constructor(
    private readonly dbName: string,
    private readonly storeName: string,
    private readonly version: number = 1
  ) {
    this.name = `indexedDB:${dbName}:${storeName}`;
  }

  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('IndexedDB is not available');
    }
    this.db = await openDatabase(this.dbName, this.storeName, this.version);
  }

  async destroy(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  async insert(doc: T): Promise<string> {
    const store = this.getStore('readwrite');
    await promisifyRequest(store.add(doc));
    return doc.id;
  }

  async insertMany(docs: T[]): Promise<string[]> {
    const store = this.getStore('readwrite');

    for (const doc of docs) {
      store.add(doc);
    }

    await promisifyTransaction(store.transaction);
    return docs.map((d) => d.id);
  }

  async update(id: string, doc: Partial<T>): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Document with id "${id}" not found`);
    }

    const updated = { ...existing, ...doc };
    const store = this.getStore('readwrite');
    await promisifyRequest(store.put(updated));
  }

  async delete(id: string): Promise<void> {
    const store = this.getStore('readwrite');
    await promisifyRequest(store.delete(id));
  }

  async deleteMany(ids: string[]): Promise<void> {
    const store = this.getStore('readwrite');

    for (const id of ids) {
      store.delete(id);
    }

    await promisifyTransaction(store.transaction);
  }

  async findById(id: string): Promise<T | null> {
    const store = this.getStore('readonly');
    const result = await promisifyRequest(store.get(id));
    return result || null;
  }

  async find(criteria?: QueryCriteria): Promise<T[]> {
    const store = this.getStore('readonly');
    let results = await promisifyRequest(store.getAll());

    if (criteria?.where) {
      results = results.filter((doc: T) => matchWhere(doc, criteria.where!));
    }

    if (criteria?.orderBy) {
      results = sortDocuments(
        results,
        criteria.orderBy,
        criteria.orderDirection
      );
    }

    results = paginateDocuments(results, criteria?.offset, criteria?.limit);

    return results;
  }

  async findOne(criteria?: QueryCriteria): Promise<T | null> {
    const results = await this.find(criteria);
    return results.length > 0 ? (results[0] as T | null) : null;
  }

  async count(criteria?: QueryCriteria): Promise<number> {
    if (!criteria) {
      const store = this.getStore('readonly');
      return promisifyRequest(store.count());
    }

    const results = await this.find(criteria);
    return results.length;
  }

  async exists(id: string): Promise<boolean> {
    const doc = await this.findById(id);
    return doc !== null;
  }

  async clear(): Promise<void> {
    const store = this.getStore('readwrite');
    await promisifyRequest(store.clear());
  }

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return getObjectStore(this.db, this.storeName, mode);
  }
}
