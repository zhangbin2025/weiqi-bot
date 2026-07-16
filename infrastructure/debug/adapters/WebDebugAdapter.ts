/**
 * Web 平台调试适配器
 * @module infrastructure/debug/adapters/WebDebugAdapter
 * 
 * 使用 LocalStorage 和 Performance API 模拟调试接口
 */

import type { IDebugAdapter } from './IDebugAdapter';
import { LogStorage } from '../LogStorage';

/**
 * Web 平台调试适配器
 */
export class WebDebugAdapter implements IDebugAdapter {
  private static logStorageInstance: LogStorage | null = null;

  /**
   * 设置 LogStorage 实例（由 Bootstrap 调用）
   */
  static setLogStorage(storage: LogStorage): void {
    WebDebugAdapter.logStorageInstance = storage;
  }

  /**
   * 获取 LogStorage 实例
   */
  private getLogStorage(): LogStorage {
    if (!WebDebugAdapter.logStorageInstance) {
      // 如果没有设置，创建一个默认实例
      WebDebugAdapter.logStorageInstance = new LogStorage();
    }
    return WebDebugAdapter.logStorageInstance;
  }

  // 日志
  getLogs(): string {
    const logs = this.getLogStorage().getLogs({ limit: 200 });

    // 转换为旧格式（兼容 DebugService）
    // 格式: timestamp|level|tag|message
    const formatted = logs.map(log => {
      return `${log.timestamp}|${log.level}|${log.tag}|${log.message}`;
    });

    return JSON.stringify(formatted);
  }

  clearLogs(): void {
    this.getLogStorage().clearLogs();
  }

  // 存储
  getFilesDir(): string {
    return 'localStorage';
  }

  getCacheDir(): string {
    return 'sessionStorage';
  }

  getFileSize(path: string): number {
    // 计算整个 LocalStorage 的大小
    return JSON.stringify(localStorage).length;
  }

  listFiles(path: string): string {
    // 返回 LocalStorage 的所有 keys
    const keys = Object.keys(localStorage);
    return JSON.stringify(keys.map(key => ({
      name: key,
      path: key,
      isDirectory: false,
      size: localStorage.getItem(key)?.length || 0,
      lastModified: Date.now()
    })));
  }

  deleteFile(path: string): boolean {
    // 删除 LocalStorage 中的指定 key
    if (path === 'localStorage') {
      localStorage.clear();
      return true;
    }
    localStorage.removeItem(path);
    return true;
  }

  // 性能
  getMaxMemory(): number {
    // 使用 Performance API 获取内存限制
    return (performance as any).memory?.jsHeapSizeLimit || 0;
  }

  getTotalMemory(): number {
    // 总内存
    return (performance as any).memory?.totalJSHeapSize || 0;
  }

  getFreeMemory(): number {
    // 已用内存（返回 usedJSHeapSize）
    return (performance as any).memory?.usedJSHeapSize || 0;
  }

  getCurrentTime(): number {
    return Date.now();
  }

  // 抓包（Web 不支持）
  getRunningSnifferSessions(): string {
    return '[]';
  }

  // App 信息
  getAppVersion(): string {
    return 'web';
  }

  getDeviceModel(): string {
    return navigator.userAgent;
  }

  getAndroidVersion(): string {
    return 'web';
  }
}
