import {
  IFileStorageAdapter,
  IFileMetadata,
  FileAdapterType,
} from '../../interfaces/IFileStorage';

/**
 * IndexedDB 文件存储适配器
 * @description 使用 IndexedDB 存储文件，支持大文件、分块读写
 */
export class IndexedDBFileAdapter implements IFileStorageAdapter {
  readonly name: string;
  readonly type = FileAdapterType.IndexedDB;

  private dbName: string;
  private db: IDBDatabase | null = null;
  private storeName = 'files';

  constructor(dbName: string = 'file-storage') {
    this.dbName = dbName;
    this.name = `indexedDB-file:${dbName}`;
  }

  async initialize(): Promise<void> {
    if (!this.isAvailable()) throw new Error('IndexedDB is not available');

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = () => reject(new Error(`Failed to open database: ${request.error}`));
      request.onsuccess = () => { this.db = request.result; resolve(); };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'path' });
          store.createIndex('dirPath', 'dirPath', { unique: false });
        }
      };
    });
  }

  async destroy(): Promise<void> {
    if (this.db) { this.db.close(); this.db = null; }
  }

  isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  async upload(path: string, data: Blob | ArrayBuffer): Promise<void> {
    const blob = data instanceof ArrayBuffer ? new Blob([data]) : data;
    const fileData = {
      path,
      dirPath: this.getDirPath(path),
      data: blob,
      size: blob.size,
      contentType: blob.type || 'application/octet-stream',
      lastModified: new Date(),
    };
    const store = this.getStore('readwrite');
    await this.promisifyRequest(store.put(fileData));
  }

  async download(path: string): Promise<Blob> {
    const store = this.getStore('readonly');
    const result = await this.promisifyRequest(store.get(path));
    if (!result) throw new Error(`File not found: ${path}`);
    return result.data;
  }

  async delete(path: string): Promise<void> {
    const store = this.getStore('readwrite');
    await this.promisifyRequest(store.delete(path));
  }

  async exists(path: string): Promise<boolean> {
    const store = this.getStore('readonly');
    const result = await this.promisifyRequest(store.get(path));
    return !!result;
  }

  async getMetadata(path: string): Promise<IFileMetadata> {
    const store = this.getStore('readonly');
    const result = await this.promisifyRequest(store.get(path));
    if (!result) throw new Error(`File not found: ${path}`);
    return {
      path: result.path,
      size: result.size,
      contentType: result.contentType,
      lastModified: result.lastModified,
    };
  }

  async readChunk(path: string, start: number, end: number): Promise<ArrayBuffer> {
    const blob = await this.download(path);
    const chunk = blob.slice(start, end);
    return chunk.arrayBuffer();
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const store = this.getStore('readonly');
    const index = store.index('dirPath');
    const results = await this.promisifyRequest(index.getAll(dirPath));
    return results.map((item: any) => item.path);
  }

  async createDirectory(_dirPath: string): Promise<void> {
    // IndexedDB 不需要显式创建目录
  }

  async deleteDirectory(dirPath: string, recursive: boolean = false): Promise<void> {
    if (recursive) {
      const files = await this.listFiles(dirPath);
      for (const file of files) await this.delete(file);
    }
    const store = this.getStore('readwrite');
    await this.promisifyRequest(store.delete(dirPath));
  }

  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  private getDirPath(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash > 0 ? path.substring(0, lastSlash) : '';
  }

  private promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Request failed: ${request.error}`));
    });
  }
}
