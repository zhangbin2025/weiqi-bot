/**
 * 调试服务接口
 * @module services/debug/IDebugService
 */

import type { LogEntry, LogFilter, LogStats, StorageStats, MemoryInfo, AppInfo, FileInfo } from './types';

/**
 * 调试服务接口
 */
export interface IDebugService {
  // 日志
  getLogs(filter?: LogFilter): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;
  getLogStats(): Promise<LogStats>;
  
  // 存储
  getStorageStats(): Promise<StorageStats>;
  listFiles(path: string): Promise<FileInfo[]>;
  deleteFile(path: string): Promise<boolean>;
  clearCache(): Promise<boolean>;
  
  // 性能
  getMemoryInfo(): Promise<MemoryInfo>;
  
  // App 信息
  getAppInfo(): Promise<AppInfo>;
  
  // 抓包
  getRunningSnifferSessions(): Promise<string[]>;
}
