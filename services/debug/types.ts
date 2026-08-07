/**
 * 调试服务类型定义
 * @module services/debug/types
 */

/**
 * 日志条目
 */
export interface LogEntry {
  timestamp: number;
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  tag: string;
  message: string;
}

/**
 * 文件信息
 */
export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  lastModified: number;
}

/**
 * 内存信息
 */
export interface MemoryInfo {
  max: number;
  total: number;
  free: number;
  used: number;
  usagePercent: number;
}

/**
 * 存储统计
 */
export interface StorageStats {
  cache: { size: number; formatted: string };
  internal: { size: number; formatted: string };
  total: { size: number; formatted: string };
}

/**
 * App 信息
 */
export interface AppInfo {
  version: string;
  model: string;
  os: string;
  platform: string;
}

/**
 * 日志筛选条件
 */
export interface LogFilter {
  level?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  tag?: string;
  limit?: number;
}

/**
 * 日志统计
 */
export interface LogStats {
  total: number;
  error: number;
  warn: number;
  info: number;
  debug: number;
}
