/**
 * 存储浏览服务
 * @module services/storage/StorageBrowserService
 * 
 * 提供存储内容的格式化和展示逻辑，作为命令层的接口
 */

import type { IStorageService } from './IStorageService';
import type {
  LocalStorageItem,
  SessionStorageItem,
  IndexedDBDatabase,
  IndexedDBObjectStore,
  IndexedDBItem,
  CacheStorageInfo,
  CacheRequestInfo,
} from './IStorageService';
import type { IFileExporter } from '../../infrastructure/utils/export';

/**
 * 存储浏览服务配置
 */
export interface StorageBrowserConfig {
  storageService: IStorageService;
  fileExporter?: IFileExporter;
}

/**
 * 存储类型
 */
export type StorageType = 'local' | 'session' | 'idb' | 'cache';

/**
 * 存储浏览服务
 * 
 * 提供存储内容的浏览、格式化和展示功能
 */
export class StorageBrowserService {
  constructor(private config: StorageBrowserConfig) {}

  // ========== 概览显示 ==========

  /**
   * 显示存储概览
   */
  async showOverview(): Promise<string> {
    try {
      const info = await this.config.storageService.getStorageInfo();
      
      // 检测是否在 App 环境
      const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
      
      let text = '## 💾 存储概览\n\n';
      text += '| 存储类型 | 大小 |\n';
      text += '|---------|------|\n';
      
      if (isApp) {
        // App 端显示更详细的信息
        const detailedInfo = info as any;
        text += `| App 内部存储 | ${this.formatSize(detailedInfo.appFilesSize || 0)} |\n`;
        text += `| App 缓存存储 | ${this.formatSize(detailedInfo.appCacheSize || 0)} |\n`;
        text += `| Web 浏览器缓存 | ${this.formatSize(info.cacheSize)} |\n`;
        text += `| Web IndexedDB | ${this.formatSize(info.idbSize)} |\n`;
        text += `| Web LocalStorage | ${this.formatSize(info.localStorageSize)} |\n`;
        text += `| Web SessionStorage | ${this.formatSize(info.sessionStorageSize)} |\n`;
      } else {
        // Web 端
        text += `| 浏览器缓存 | ${this.formatSize(info.cacheSize)} |\n`;
        text += `| IndexedDB | ${this.formatSize(info.idbSize)} |\n`;
        text += `| LocalStorage | ${this.formatSize(info.localStorageSize)} |\n`;
        text += `| SessionStorage | ${this.formatSize(info.sessionStorageSize)} |\n`;
      }
      
      text += `\n**总计**: ${this.formatSize(info.totalSize)}\n`;
      text += `<br>`;
      text += '[🗑️ 清空缓存](store-clear:cache)';
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to get storage overview:', error);
      return `❌ 查询存储信息失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  // ========== LocalStorage 浏览 ==========

  /**
   * 列出 LocalStorage
   */
  async listLocalStorage(): Promise<string> {
    try {
      const items = await this.config.storageService.listLocalStorage();
      
      if (items.length === 0) {
        return '📋 LocalStorage\n\n暂无数据';
      }

      const totalSize = items.reduce((sum, item) => sum + item.size, 0);
      
      let text = `📋 LocalStorage（共 ${items.length} 项，总计 ${this.formatSize(totalSize)}）\n\n`;
      text += '| Key | Value | Size |\n';
      text += '|-----|-------|------|\n';
      
      for (const item of items) {
        const truncatedValue = this.truncateValue(item.value, 50);
        text += `| \`${item.key}\` | ${truncatedValue} | ${this.formatSize(item.size)} |\n`;
      }
      
      text += `\n💡 使用 \`/store get local <key>\` 查看完整内容`;
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to list localStorage:', error);
      return `❌ 查询 LocalStorage 失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 获取 LocalStorage 项
   */
  async getLocalStorageItem(key: string): Promise<string> {
    try {
      const value = this.config.storageService.getLocalStorageItem(key);
      
      if (value === null) {
        return `❌ 未找到 key: ${key}`;
      }

      let text = `📋 LocalStorage - ${key}\n\n`;
      text += this.formatValue(value);
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to get localStorage item:', error);
      return `❌ 获取 LocalStorage 项失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  // ========== SessionStorage 浏览 ==========

  /**
   * 列出 SessionStorage
   */
  async listSessionStorage(): Promise<string> {
    try {
      const items = await this.config.storageService.listSessionStorage();
      
      if (items.length === 0) {
        return '📋 SessionStorage\n\n暂无数据';
      }

      const totalSize = items.reduce((sum, item) => sum + item.size, 0);
      
      let text = `📋 SessionStorage（共 ${items.length} 项，总计 ${this.formatSize(totalSize)}）\n\n`;
      text += '| Key | Value | Size |\n';
      text += '|-----|-------|------|\n';
      
      for (const item of items) {
        const truncatedValue = this.truncateValue(item.value, 50);
        text += `| \`${item.key}\` | ${truncatedValue} | ${this.formatSize(item.size)} |\n`;
      }
      
      text += `\n💡 使用 \`/store get session <key>\` 查看完整内容`;
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to list sessionStorage:', error);
      return `❌ 查询 SessionStorage 失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 获取 SessionStorage 项
   */
  async getSessionStorageItem(key: string): Promise<string> {
    try {
      const value = this.config.storageService.getSessionStorageItem(key);
      
      if (value === null) {
        return `❌ 未找到 key: ${key}`;
      }

      let text = `📋 SessionStorage - ${key}\n\n`;
      text += this.formatValue(value);
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to get sessionStorage item:', error);
      return `❌ 获取 SessionStorage 项失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  // ========== IndexedDB 浏览 ==========

  /**
   * 列出 IndexedDB 数据库
   */
  async listIndexedDB(): Promise<string> {
    try {
      const databases = await this.config.storageService.listIndexedDB();
      
      if (databases.length === 0) {
        return '📋 IndexedDB\n\n暂无数据库';
      }

      let text = `📋 IndexedDB 数据库列表（共 ${databases.length} 个）\n\n`;
      
      for (const db of databases) {
        text += `**${db.name}**\n`;
        if (db.version !== undefined) {
          text += `├ 版本: ${db.version}\n`;
        }
        text += `└ [查看对象存储](store-ls:idb ${db.name})\n\n`;
      }
      
      text += `💡 使用 \`/store ls idb <dbname>\` 查看对象存储列表`;
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to list IndexedDB:', error);
      return `❌ 查询 IndexedDB 失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 列出 IndexedDB 对象存储
   */
  async listIndexedDBObjectStores(dbName: string): Promise<string> {
    try {
      const stores = await this.config.storageService.listIndexedDBObjectStores(dbName);
      
      if (stores.length === 0) {
        return `📋 IndexedDB - ${dbName}\n\n暂无对象存储`;
      }

      let text = `📋 IndexedDB - ${dbName}\n\n`;
      text += `**对象存储列表（共 ${stores.length} 个）**\n\n`;
      
      for (const store of stores) {
        text += `**${store.name}**\n`;
        text += `├ 键路径: ${store.keyPath ? JSON.stringify(store.keyPath) : '无'}\n`;
        text += `├ 自增: ${store.autoIncrement ? '是' : '否'}\n`;
        if (store.indexNames.length > 0) {
          text += `├ 索引: ${store.indexNames.join(', ')}\n`;
        }
        text += `└ [查看数据](store-ls:idb ${dbName} ${store.name})\n\n`;
      }
      
      text += `💡 使用 \`/store ls idb ${dbName} <storename>\` 查看数据`;
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to list object stores:', error);
      return `❌ 查询对象存储失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 列出 IndexedDB 数据
   */
  async listIndexedDBData(
    dbName: string,
    storeName: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<string> {
    try {
      const items = await this.config.storageService.listIndexedDBData(
        dbName,
        storeName,
        limit,
        offset
      );
      
      if (items.length === 0) {
        const msg = offset > 0 
          ? `暂无更多数据（偏移: ${offset}）`
          : '暂无数据';
        return `📋 IndexedDB - ${dbName}.${storeName}\n\n${msg}`;
      }

      let text = `📋 IndexedDB - ${dbName}.${storeName}\n\n`;
      text += `**数据列表（偏移: ${offset}，显示 ${items.length} 条）**\n\n`;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!; // 已知存在，因为 i < items.length
        text += `**${offset + i + 1}. Key: ${JSON.stringify(item.key)}**\n`;
        text += this.formatValue(item.value, 1);
        text += '\n---\n\n';
      }
      
      // 分页提示
      const nextOffset = offset + limit;
      text += `💡 使用 \`/store ls idb ${dbName} ${storeName} --limit ${limit} --offset ${nextOffset}\` 查看更多`;
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to list data:', error);
      return `❌ 查询数据失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 获取 IndexedDB 项
   */
  async getIndexedDBItem(dbName: string, storeName: string, key: any): Promise<string> {
    try {
      const value = await this.config.storageService.getIndexedDBItem(dbName, storeName, key);
      
      if (value === null) {
        return `❌ 未找到 key: ${JSON.stringify(key)}`;
      }

      let text = `📋 IndexedDB - ${dbName}.${storeName}\n\n`;
      text += `**Key**: ${JSON.stringify(key)}\n\n`;
      text += this.formatValue(value);
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to get item:', error);
      return `❌ 获取数据失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  // ========== Cache Storage 浏览 ==========

  /**
   * 列出 Cache Storage
   */
  async listCacheStorage(): Promise<string> {
    try {
      const caches = await this.config.storageService.listCacheStorage();
      
      if (caches.length === 0) {
        return '📋 Cache Storage\n\n暂无缓存';
      }

      const totalSize = caches.reduce((sum, cache) => sum + cache.size, 0);
      
      let text = `📋 Cache Storage（共 ${caches.length} 个缓存，总计 ${this.formatSize(totalSize)}）\n\n`;
      
      for (const cache of caches) {
        text += `**${cache.name}**\n`;
        text += `├ 请求数: ${cache.count} 个\n`;
        text += `├ 大小: ${this.formatSize(cache.size)}\n`;
        text += `└ [查看请求](store-ls:cache ${cache.name})\n\n`;
      }
      
      text += `💡 使用 \`/store ls cache <name>\` 查看请求列表`;
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to list cache storage:', error);
      return `❌ 查询 Cache Storage 失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 列出 Cache Storage 请求
   */
  async listCacheRequests(
    cacheName: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<string> {
    try {
      const requests = await this.config.storageService.listCacheRequests(
        cacheName,
        limit,
        offset
      );
      
      if (requests.length === 0) {
        const msg = offset > 0 
          ? `暂无更多请求（偏移: ${offset}）`
          : '暂无请求';
        return `📋 Cache Storage - ${cacheName}\n\n${msg}`;
      }

      let text = `📋 Cache Storage - ${cacheName}\n\n`;
      text += `**请求列表（偏移: ${offset}，显示 ${requests.length} 条）**\n\n`;
      text += '| URL | Method | Status | Type | Size |\n';
      text += '|-----|--------|--------|------|------|\n';
      
      for (const req of requests) {
        const shortUrl = this.truncateUrl(req.url, 60);
        const contentType = req.contentType ? this.truncateValue(req.contentType, 20) : '-';
        text += `| ${shortUrl} | ${req.method} | ${req.status} | ${contentType} | ${this.formatSize(req.size)} |\n`;
      }
      
      // 分页提示
      const nextOffset = offset + limit;
      text += `\n💡 使用 \`/store ls cache ${cacheName} --limit ${limit} --offset ${nextOffset}\` 查看更多`;
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to list cache requests:', error);
      return `❌ 查询请求列表失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 获取 Cache Storage 响应
   */
  async getCacheResponse(cacheName: string, url: string): Promise<string> {
    try {
      const response = await this.config.storageService.getCacheResponse(cacheName, url);
      
      if (response === null) {
        return `❌ 未找到 URL: ${url}`;
      }

      let text = `📋 Cache Storage - ${cacheName}\n\n`;
      text += `**URL**: ${url}\n\n`;
      
      // 根据响应类型格式化显示
      if (typeof response === 'string') {
        text += this.formatValue(response);
      } else if (response instanceof Blob) {
        text += `**类型**: Blob\n`;
        text += `**大小**: ${this.formatSize(response.size)}\n`;
        text += `**类型**: ${response.type}`;
      } else {
        // JSON 对象
        text += this.formatValue(JSON.stringify(response, null, 2));
      }
      
      return text;
    } catch (error) {
      console.error('[StorageBrowser] Failed to get cache response:', error);
      return `❌ 获取响应失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  // ========== 清空操作 ==========

  /**
   * 清空 LocalStorage
   */
  async clearLocalStorage(): Promise<string> {
    try {
      await this.config.storageService.clearLocalStorage();
      return '✅ LocalStorage 已清空';
    } catch (error) {
      console.error('[StorageBrowser] Failed to clear localStorage:', error);
      return `❌ 清空 LocalStorage 失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 清空 SessionStorage
   */
  async clearSessionStorage(): Promise<string> {
    try {
      await this.config.storageService.clearSessionStorage();
      return '✅ SessionStorage 已清空';
    } catch (error) {
      console.error('[StorageBrowser] Failed to clear sessionStorage:', error);
      return `❌ 清空 SessionStorage 失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 清空 IndexedDB
   */
  async clearIndexedDB(dbName?: string): Promise<string> {
    try {
      await this.config.storageService.clearIndexedDB(dbName);
      const msg = dbName 
        ? `✅ IndexedDB 数据库 "${dbName}" 已删除`
        : '✅ IndexedDB 已清空';
      return msg;
    } catch (error) {
      console.error('[StorageBrowser] Failed to clear IndexedDB:', error);
      return `❌ 清空 IndexedDB 失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 清空 Cache Storage
   */
  async clearCacheStorage(cacheName?: string): Promise<string> {
    try {
      await this.config.storageService.clearCacheStorage(cacheName);
      const msg = cacheName 
        ? `✅ Cache "${cacheName}" 已删除`
        : '✅ Cache Storage 已清空';
      return msg;
    } catch (error) {
      console.error('[StorageBrowser] Failed to clear cache storage:', error);
      return `❌ 清空 Cache Storage 失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 清空所有缓存
   */
  async clearAllCache(): Promise<string> {
    try {
      await this.config.storageService.clearCache();
      return '✅ 所有缓存已清空\n\n页面即将刷新...';
    } catch (error) {
      console.error('[StorageBrowser] Failed to clear all cache:', error);
      return `❌ 清空缓存失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  // ========== 导出导入 ==========

  /**
   * 导出用户数据
   */
  async exportUserData(): Promise<string> {
    try {
      const blob = await this.config.storageService.exportUserData();
      const filename = `weiqi-bot-export-${Date.now()}.zip`;
      
      // 优先使用 IFileExporter（App 环境走 SAF 桥接，Web 环境走 <a> 下载）
      if (this.config.fileExporter) {
        const result = await this.config.fileExporter.exportBlob(blob, filename);
        if (result.success) {
          return `✅ 数据已导出\n\n文件：${result.path || filename}`;
        } else {
          return `❌ 导出失败: ${result.error || '未知错误'}`;
        }
      }
      
      // fallback：直接 <a> 下载
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      
      return `✅ 数据已导出\n\n文件：${filename}`;
    } catch (error) {
      console.error('[StorageBrowser] Failed to export user data:', error);
      return `❌ 导出失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 导入用户数据
   */
  async importUserData(): Promise<string> {
    // 创建文件选择器
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    
    return new Promise((resolve) => {
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) {
          resolve('❌ 未选择文件');
          return;
        }
        
        try {
          await this.config.storageService.importUserData(file);
          // App 环境自动刷新，Web 环境提示手动刷新
          const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
          if (isApp) {
            resolve('✅ 数据已导入\n\n页面即将刷新...');
            setTimeout(() => { try { prompt('debug:refresh'); } catch (e) { window.location.reload(); } }, 1000);
          } else {
            resolve('✅ 数据已导入\n\n<a href="javascript:location.reload()" style="color:#4a9eff;text-decoration:underline;cursor:pointer">点击刷新页面</a> 使数据生效');
          }
        } catch (error) {
          resolve(`❌ 导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      };
      
      input.click();
    });
  }

  // ========== 辅助方法 ==========

  /**
   * 格式化大小
   */
  private formatSize(bytes: number): string {
    return this.config.storageService.formatSize(bytes);
  }

  /**
   * 截断值
   */
  private truncateValue(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return value.substring(0, maxLength) + '...';
  }

  /**
   * 截断 URL
   */
  private truncateUrl(url: string, maxLength: number): string {
    if (url.length <= maxLength) {
      return url;
    }
    // 保留域名和路径开头/结尾
    const start = url.substring(0, maxLength * 0.6);
    const end = url.substring(url.length - maxLength * 0.3);
    return `${start}...${end}`;
  }

  /**
   * 格式化值（支持 JSON 格式化）
   */
  private formatValue(value: any, indentLevel: number = 0): string {
    const indent = '  '.repeat(indentLevel);
    
    // 如果已经是对象类型，直接格式化
    if (typeof value === 'object' && value !== null) {
      try {
        const formatted = JSON.stringify(value, null, 2);
        return `\`\`\`json\n${formatted}\n\`\`\``;
      } catch (error) {
        // JSON.stringify 失败（可能包含循环引用）
        return `\`\`\`\n${String(value)}\n\`\`\``;
      }
    }
    
    // 如果是字符串，尝试解析为 JSON
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        const formatted = JSON.stringify(parsed, null, 2);
        return `\`\`\`json\n${formatted}\n\`\`\``;
      } catch {
        // 不是 JSON，直接返回
        return `\`\`\`\n${value}\n\`\`\``;
      }
    }
    
    // 其他类型（数字、布尔等）
    return `\`\`\`\n${String(value)}\n\`\`\``;
  }
}
