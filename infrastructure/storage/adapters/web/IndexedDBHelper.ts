/**
 * IndexedDB 辅助工具
 * @description 提供 IndexedDB 的底层操作封装
 */

/**
 * 打开或创建数据库
 */
export function openDatabase(
  dbName: string,
  storeName: string,
  version: number = 1
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // 先尝试以当前版本打开
    const checkRequest = indexedDB.open(dbName);
    
    checkRequest.onerror = () => {
      reject(new Error(`Failed to open database: ${checkRequest.error}`));
    };
    
    checkRequest.onsuccess = () => {
      const existingDb = checkRequest.result;
      const existingVersion = existingDb.version;
      existingDb.close();
      
      // 使用已存在版本或默认版本
      const targetVersion = existingVersion > 0 ? existingVersion : version;
      
      const request = indexedDB.open(dbName, targetVersion);
      
      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error}`));
      };
      
      request.onsuccess = () => {
        const db = request.result;
        // 如果 object store 不存在，需要升级版本
        if (!db.objectStoreNames.contains(storeName)) {
          const currentVersion = db.version;
          db.close();
          // 创建新版本
          const upgradeRequest = indexedDB.open(dbName, currentVersion + 1);
          upgradeRequest.onerror = () => reject(new Error(`Failed to upgrade database: ${upgradeRequest.error}`));
          upgradeRequest.onupgradeneeded = (event) => {
            const upgradeDb = (event.target as IDBOpenDBRequest).result;
            upgradeDb.createObjectStore(storeName, { keyPath: 'id' });
          };
          upgradeRequest.onsuccess = () => resolve(upgradeRequest.result);
          return;
        }
        resolve(db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      };
    };
  });
}

/**
 * 获取对象存储
 */
export function getObjectStore(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode
): IDBObjectStore {
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

/**
 * 执行 IDBRequest 并返回 Promise
 */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error(`Request failed: ${request.error}`));
    };
  });
}

/**
 * 执行事务并返回 Promise
 */
export function promisifyTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(new Error(`Transaction failed: ${transaction.error}`));
    };
  });
}

/**
 * 匹配 where 条件
 */
export function matchWhere<T>(
  doc: T,
  where: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(where)) {
    const docValue = (doc as Record<string, unknown>)[key];
    if (docValue !== value) {
      return false;
    }
  }
  return true;
}

/**
 * 排序文档
 */
export function sortDocuments<T>(
  documents: T[],
  orderBy: string,
  direction: 'asc' | 'desc' = 'asc'
): T[] {
  const factor = direction === 'desc' ? -1 : 1;

  return documents.sort((a, b) => {
    const aVal = (a as Record<string, unknown>)[orderBy];
    const bVal = (b as Record<string, unknown>)[orderBy];

    if ((aVal as number) < (bVal as number)) return -1 * factor;
    if ((aVal as number) > (bVal as number)) return 1 * factor;
    return 0;
  });
}

/**
 * 分页文档
 */
export function paginateDocuments<T>(
  documents: T[],
  offset?: number,
  limit?: number
): T[] {
  let result = documents;

  if (offset !== undefined && offset > 0) {
    result = result.slice(offset);
  }

  if (limit !== undefined && limit > 0) {
    result = result.slice(0, limit);
  }

  return result;
}
