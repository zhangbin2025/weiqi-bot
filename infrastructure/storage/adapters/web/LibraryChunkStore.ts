/**
 * 内置题库分块缓存（IndexedDB）
 * @module infrastructure/storage/adapters/web/LibraryChunkStore
 *
 * @description
 * 缓存已下载的内置题库分块（.pNNNN.tar.bz2），使刷新页面不必重新下载。
 *
 * 背景：题库按 1000 条/块切分后，取一条只需下载所在块（~90KB）。
 * 但若不做持久化，页面刷新后内存缓存清空、又要重新下载 —— 用户每次打开
 * 做题页都要付一次 90KB。缓存后只有首次需要网络。
 *
 * 容量与回收：单套数据约 6.3MB（题库 3.4MB + 棋谱 2.9MB）。
 * 缓存键含构建版本，故每次重建都会留下一套新键 —— 若不回收，IndexedDB 会
 * 随发布次数线性增长（每周重建 ≈ 一年 300MB+），写满后 set 静默失败、
 * 表现为「缓存莫名其妙不生效」。故由 BuiltinLibraryArchiveProvider 在取到
 * meta 后调用 keys()/delete() 清理非当前版本的键。
 */

const DB_NAME = 'weiqi-bot-chunk-store';
const STORE_NAME = 'chunks';
const DB_VERSION = 1;

/** 缓存记录 */
interface ChunkRecord {
  key: string;
  data: ArrayBuffer;
  updatedAt: number;
}

export class LibraryChunkStore {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  /** IndexedDB 是否可用（隐私模式 / 非浏览器环境会不可用） */
  isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  /** 读取块数据；未命中返回 null */
  async get(key: string): Promise<Uint8Array | null> {
    if (!this.isAvailable()) return null;
    const db = await this.open();
    if (!db) return null;
    try {
      const rec = await this.tx<ChunkRecord | undefined>(db, STORE_NAME, 'readonly', (store) => store.get(key) as IDBRequest<ChunkRecord | undefined>);
      return rec?.data ? new Uint8Array(rec.data) : null;
    } catch {
      return null; // 读取失败按未命中处理，走网络
    }
  }

  /** 写入块数据 */
  async set(key: string, data: Uint8Array): Promise<void> {
    if (!this.isAvailable()) return;
    const db = await this.open();
    if (!db) return;
    // 拷一份独立 ArrayBuffer：Uint8Array 可能是底层大缓冲的视图，
    // 直接存会连带持有整块内存（结构化克隆也可能因此失败）
    const copy = data.slice().buffer;
    const rec: ChunkRecord = { key, data: copy, updatedAt: Date.now() };
    try {
      await this.tx<void>(db, STORE_NAME, 'readwrite', (store) => store.put(rec) as IDBRequest<IDBValidKey>);
    } catch {
      /* 写入失败不阻断取题，仅失去缓存 */
    }
  }

  /** 删除某个块（数据更新后可按需清理） */
  async delete(key: string): Promise<void> {
    if (!this.isAvailable()) return;
    const db = await this.open();
    if (!db) return;
    try {
      await this.tx<void>(db, STORE_NAME, 'readwrite', (store) => store.delete(key) as IDBRequest<undefined>);
    } catch {
      /* ignore */
    }
  }

  /** 列出全部缓存键（用于回收历史版本留下的块） */
  async keys(): Promise<string[]> {
    if (!this.isAvailable()) return [];
    const db = await this.open();
    if (!db) return [];
    try {
      const all = await this.tx<ChunkRecord[]>(db, STORE_NAME, 'readonly', (store) => store.getAll() as IDBRequest<ChunkRecord[]>);
      return (all ?? []).map(r => r.key);
    } catch {
      return [];
    }
  }

  /** 清空全部块缓存 */
  async clear(): Promise<void> {
    if (!this.isAvailable()) return;
    const db = await this.open();
    if (!db) return;
    try {
      await this.tx<void>(db, STORE_NAME, 'readwrite', (store) => store.clear() as IDBRequest<undefined>);
    } catch {
      /* ignore */
    }
  }

  // ==================== 底层 ====================

  private open(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return this.dbPromise;
  }

  private tx<T>(
    db: IDBDatabase,
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = run(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}
