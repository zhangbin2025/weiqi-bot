/**
 * 存储导出导入模块
 * @module services/storage/export-import/StorageExportImport
 * 
 * 提供用户数据的导出和导入功能
 * 
 * ## 存储全景图
 * 
 * ### IndexedDB 数据库
 * | 数据库名 | 对象存储 | 类型 | 导出? |
 * |----------|---------|------|------|
 * | weiqi-assistant | favorites | 用户数据 | ✅ |
 * | weiqi-bot-favorite | items | 用户数据 | ✅ |
 * | weiqi-bot-player | results | 缓存 | ✅ |
 * | weiqi-bot-event | results | 缓存 | ✅ |
 * | weiqi-bot-readmark | marks | 用户数据 | ✅ |
 * | weiqi-bot-game-history | index | 用户数据 | ✅ |
 * | weiqi-bot-game-files | files | 文件(Blob) | ❌ |
 * | weiqi-favorites | items | 用户数据 | ✅ |
 * | weiqi-activity | entries | 用户数据 | ✅ |
 * | weiqi-models | models | 缓存(Blob) | ❌ |
 * | tensorflowjs | * | 模型缓存 | ❌ |
 * 
 * ### LocalStorage 命名空间
 * | 前缀 | 类型 | 导出? |
 * |------|------|------|
 * | weiqi-session:* | 临时缓存(TTL) | ✅ |
 * | weiqi-joseki:* | 已读标记 | ✅ |
 * | 其他 | 视情况 | ✅ |
 * 
 * ## ZIP 文件结构
 * weiqi-bot-export-{timestamp}.zip
 * ├── manifest.json
 * ├── localStorage.json
 * └── indexeddb/
 *     ├── weiqi-assistant.json
 *     ├── weiqi-bot-favorite.json
 *     └── ...
 */

import JSZip from 'jszip';
import type { IStorageService } from '../IStorageService';
import type { ExportManifest } from './types';

/**
 * 不导出的 IndexedDB 数据库
 * - tensorflowjs: TF.js 模型缓存，体积大，可重新下载
 * - weiqi-models: KataGo 模型缓存，体积大，可重新下载
 * - weiqi-bot-game-files: 文件存储，Blob 无法 JSON 序列化
 * - file-storage: 旧版文件存储，同上
 */
const EXCLUDE_DATABASES = new Set([
  'tensorflowjs',
  'weiqi-models',
  'weiqi-bot-game-files',
  'file-storage',
]);

export class StorageExportImport {
  constructor(private storageService: IStorageService) {}

  // ========== 导出 ==========

  /**
   * 导出用户数据为 ZIP
   */
  async exportUserData(): Promise<Blob> {
    const zip = new JSZip();
    
    // 1. 导出 LocalStorage
    const localData = await this.exportLocalStorage();
    zip.file('localStorage.json', JSON.stringify(localData, null, 2));
    
    // 2. 导出 IndexedDB（每个数据库一个文件）
    const idbFolder = zip.folder('indexeddb')!;
    await this.exportAllIndexedDB(idbFolder);
    
    // 3. 添加清单
    const manifest: ExportManifest = {
      version: '1.0',
      app: 'weiqi-bot',
      timestamp: new Date().toISOString(),
      exportSize: Object.keys(localData).length,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    
    return zip.generateAsync({ type: 'blob' });
  }

  // ========== 导入 ==========

  /**
   * 从 ZIP 导入用户数据
   * 
   * 策略：先清空再写入，不清数据库（避免 blocked），而是清空对象存储
   */
  async importUserData(blob: Blob): Promise<void> {
    const zip = await JSZip.loadAsync(blob);
    
    // 1. 验证清单
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('无效的导出文件：缺少 manifest.json');
    }
    const manifest = JSON.parse(await manifestFile.async('text'));
    if (manifest.app !== 'weiqi-bot') {
      throw new Error('无效的导出文件：不是 weiqi-bot 导出数据');
    }
    
    // 2. 导入 LocalStorage（直接覆盖，不清空）
    await this.importLocalStorage(zip);
    
    // 3. 导入 IndexedDB（每个数据库：先清空对象存储，再写入）
    await this.importAllIndexedDB(zip);
  }

  // ========== 导出实现 ==========

  private async exportLocalStorage(): Promise<Record<string, string>> {
    const items = await this.storageService.listLocalStorage();
    const data: Record<string, string> = {};
    for (const item of items) {
      data[item.key] = item.value;
    }
    console.log(`[ExportImport] Exported ${items.length} localStorage items`);
    return data;
  }

  private async exportAllIndexedDB(idbFolder: JSZip): Promise<void> {
    const databases = await this.storageService.listIndexedDB();
    let totalCount = 0;
    
    for (const db of databases) {
      if (!db.name || EXCLUDE_DATABASES.has(db.name)) continue;
      
      try {
        const dbData = await this.exportOneDatabase(db.name);
        if (dbData && Object.keys(dbData).length > 0) {
          idbFolder.file(`${db.name}.json`, JSON.stringify(dbData, null, 2));
          let count = 0;
          for (const items of Object.values(dbData)) {
            count += (items as any[]).length;
          }
          totalCount += count;
          console.log(`[ExportImport] Exported DB ${db.name}: ${count} records`);
        }
      } catch (error) {
        console.error(`[ExportImport] Failed to export DB ${db.name}:`, error);
      }
    }
    
    console.log(`[ExportImport] Total exported ${totalCount} IndexedDB records`);
  }

  /**
   * 导出单个数据库的所有对象存储
   * @returns { storeName: [{ key, value }, ...] } 或 null
   */
  private async exportOneDatabase(dbName: string): Promise<Record<string, any[]> | null> {
    const stores = await this.storageService.listIndexedDBObjectStores(dbName);
    if (stores.length === 0) return null;
    
    const dbData: Record<string, any[]> = {};
    let hasData = false;
    
    for (const store of stores) {
      try {
        const items = await this.storageService.listIndexedDBData(dbName, store.name, 100000, 0);
        if (items.length > 0) {
          dbData[store.name] = items;
          hasData = true;
        }
      } catch (error) {
        console.error(`[ExportImport] Failed to export ${dbName}.${store.name}:`, error);
      }
    }
    
    return hasData ? dbData : null;
  }

  // ========== 导入实现 ==========

  private async importLocalStorage(zip: JSZip): Promise<void> {
    const localFile = zip.file('localStorage.json');
    if (!localFile) {
      console.log('[ExportImport] No localStorage.json, skipping');
      return;
    }
    
    const localData = JSON.parse(await localFile.async('text'));
    
    // 先清空，再写入
    localStorage.clear();
    
    let imported = 0;
    for (const [key, value] of Object.entries(localData)) {
      try {
        localStorage.setItem(key, value as string);
        imported++;
      } catch (error) {
        console.error(`[ExportImport] Failed to set localStorage ${key}:`, error);
      }
    }
    
    console.log(`[ExportImport] Imported ${imported} localStorage items`);
  }

  private async importAllIndexedDB(zip: JSZip): Promise<void> {
    const idbFolder = zip.folder('indexeddb');
    if (!idbFolder) {
      console.log('[ExportImport] No indexeddb/ folder, skipping');
      return;
    }
    
    // 遍历 indexeddb/ 下所有 .json 文件
    const jsonFiles = Object.keys(zip.files).filter(
      name => name.startsWith('indexeddb/') && name.endsWith('.json')
    );
    
    if (jsonFiles.length === 0) {
      console.log('[ExportImport] No IndexedDB files in zip, skipping');
      return;
    }
    
    let totalImported = 0;
    
    for (const filePath of jsonFiles) {
      const file = zip.file(filePath);
      if (!file) continue;
      
      // 从路径提取数据库名：indexeddb/weiqi-bot-player.json → weiqi-bot-player
      const dbName = filePath.replace(/^indexeddb\//, '').replace(/\.json$/, '');
      
      if (EXCLUDE_DATABASES.has(dbName)) continue;
      
      try {
        const storesData = JSON.parse(await file.async('text'));
        const count = await this.importOneDatabase(dbName, storesData);
        totalImported += count;
      } catch (error) {
        console.error(`[ExportImport] Failed to import ${dbName}:`, error);
      }
    }
    
    console.log(`[ExportImport] Total imported ${totalImported} IndexedDB records`);
  }

  /**
   * 导入单个数据库
   * 
   * 关键：不删除数据库（避免 blocked），而是打开现有数据库，
   * 清空对象存储，再写入数据
   */
  private async importOneDatabase(dbName: string, storesData: Record<string, any[]>): Promise<number> {
    let totalImported = 0;
    
    for (const [storeName, items] of Object.entries(storesData)) {
      if (!Array.isArray(items) || items.length === 0) continue;
      
      try {
        const count = await this.clearAndImportStore(dbName, storeName, items);
        totalImported += count;
      } catch (error) {
        console.error(`[ExportImport] Failed to import ${dbName}.${storeName}:`, error);
      }
    }
    
    console.log(`[ExportImport] Imported ${totalImported} records into ${dbName}`);
    return totalImported;
  }

  /**
   * 清空对象存储并导入数据
   * 
   * 核心逻辑：
   * 1. 打开现有数据库
   * 2. 如果对象存储不存在，通过 version upgrade 创建它
   * 3. 清空对象存储（store.clear()）
   * 4. 逐条写入数据（store.put(value)）
   * 
   * 注意：item.value 是完整文档，已包含 keyPath 字段（如 id），
   * 所以只用 store.put(value)，不要传第二个参数。
   */
  private async clearAndImportStore(dbName: string, storeName: string, items: any[]): Promise<number> {
    // 先确保数据库和对象存储存在
    const db = await this.ensureStore(dbName, storeName);
    if (!db) {
      console.error(`[ExportImport] Failed to ensure ${dbName}.${storeName}`);
      return 0;
    }
    
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      
      // 1. 清空
      store.clear();
      
      // 2. 逐条写入
      let imported = 0;
      for (const item of items) {
        if (item.value == null) continue;
        try {
          store.put(item.value);
          imported++;
        } catch (e) {
          console.warn(`[ExportImport] put failed in ${dbName}.${storeName}:`, e);
        }
      }
      
      return new Promise<number>((resolve) => {
        tx.oncomplete = () => { db.close(); resolve(imported); };
        tx.onerror = () => { console.error(`[ExportImport] tx error in ${dbName}.${storeName}:`, tx.error); db.close(); resolve(imported); };
        tx.onabort = () => { console.error(`[ExportImport] tx aborted in ${dbName}.${storeName}`); db.close(); resolve(imported); };
      });
    } catch (error) {
      console.error(`[ExportImport] tx failed for ${dbName}.${storeName}:`, error);
      db.close();
      return 0;
    }
  }

  /**
   * 确保数据库和对象存储存在
   * 
   * 如果对象存储不存在，通过 version upgrade 创建（keyPath='id'）
   */
  private ensureStore(dbName: string, storeName: string): Promise<IDBDatabase> {
    return new Promise((resolve) => {
      // 第一次：尝试直接打开
      const request = indexedDB.open(dbName);
      
      request.onerror = () => {
        console.error(`[ExportImport] Failed to open ${dbName}:`, request.error);
        resolve(null as any);
      };
      
      request.onsuccess = () => {
        const db = request.result;
        
        if (db.objectStoreNames.contains(storeName)) {
          // 对象存储已存在，直接返回
          resolve(db);
        } else {
          // 对象存储不存在，需要 version upgrade 来创建
          const currentVersion = db.version;
          db.close();
          
          console.log(`[ExportImport] Creating store ${storeName} in ${dbName} (version ${currentVersion} → ${currentVersion + 1})`);
          
          const upgradeRequest = indexedDB.open(dbName, currentVersion + 1);
          
          upgradeRequest.onupgradeneeded = () => {
            const upgradeDb = upgradeRequest.result;
            if (!upgradeDb.objectStoreNames.contains(storeName)) {
              upgradeDb.createObjectStore(storeName, { keyPath: 'id' });
            }
          };
          
          upgradeRequest.onsuccess = () => resolve(upgradeRequest.result);
          upgradeRequest.onerror = () => {
            console.error(`[ExportImport] Failed to upgrade ${dbName}:`, upgradeRequest.error);
            resolve(null as any);
          };
        }
      };
    });
  }
}
