/**
 * 调试服务实现
 * @module services/debug/DebugService
 */

import type { IDebugService } from './IDebugService';
import type { LogEntry, LogFilter, LogStats, StorageStats, MemoryInfo, AppInfo, FileInfo } from './types';
import { createDebugAdapter } from '../../infrastructure/debug';

/**
 * 调试服务
 * 封装上层接口，提供业务逻辑
 */
export class DebugService implements IDebugService {
  private adapter: import('../../infrastructure/debug').IDebugAdapter;
  
  constructor() {
    this.adapter = createDebugAdapter();
  }
  
  // ========== 日志 ==========
  
  async getLogs(filter?: LogFilter): Promise<LogEntry[]> {
    const logsJson = await this.adapter.getLogs() || '[]';
    const logs = JSON.parse(logsJson as string) as string[];
    
    // 解析日志
    let parsed = logs.map(log => {
      const parts = log.split('|');
      const [timestamp, level, tag, ...messageParts] = parts;
      return {
        timestamp: parseInt(timestamp ?? '0'),
        level: (level ?? 'INFO') as LogEntry['level'],
        tag: tag ?? '',
        message: messageParts.join('|')
      };
    });
    
    // 筛选
    if (filter?.level) {
      parsed = parsed.filter(log => log.level === filter.level);
    }
    if (filter?.tag) {
      parsed = parsed.filter(log => log.tag.includes(filter.tag ?? ''));
    }
    if (filter?.limit) {
      parsed = parsed.slice(-filter.limit);
    }
    
    return parsed;
  }
  
  async clearLogs(): Promise<void> {
    this.adapter.clearLogs();
  }
  
  async getLogStats(): Promise<LogStats> {
    const logs = await this.getLogs();
    return {
      total: logs.length,
      error: logs.filter(l => l.level === 'ERROR').length,
      warn: logs.filter(l => l.level === 'WARN').length,
      info: logs.filter(l => l.level === 'INFO').length,
      debug: logs.filter(l => l.level === 'DEBUG').length
    };
  }
  
  // ========== 存储 ==========
  
  async getStorageStats(): Promise<StorageStats> {
    const cacheDir = this.adapter.getCacheDir() || '';
    const filesDir = this.adapter.getFilesDir() || '';
    
    const cacheSize = this.adapter.getFileSize(cacheDir as string);
    const internalSize = this.adapter.getFileSize(filesDir as string);
    
    return {
      cache: {
        size: cacheSize,
        formatted: this.formatSize(cacheSize)
      },
      internal: {
        size: internalSize,
        formatted: this.formatSize(internalSize)
      },
      total: {
        size: cacheSize + internalSize,
        formatted: this.formatSize(cacheSize + internalSize)
      }
    };
  }
  
  async listFiles(path: string): Promise<FileInfo[]> {
    const filesJson = this.adapter.listFiles(path);
    return JSON.parse(filesJson);
  }
  
  async deleteFile(path: string): Promise<boolean> {
    return this.adapter.deleteFile(path);
  }
  
  async clearCache(): Promise<boolean> {
    const cacheDir = this.adapter.getCacheDir();
    return this.adapter.deleteFile(cacheDir);
  }
  
  // ========== 性能 ==========
  
  async getMemoryInfo(): Promise<MemoryInfo> {
    const max = this.adapter.getMaxMemory();
    const total = this.adapter.getTotalMemory();
    const free = this.adapter.getFreeMemory();
    const used = total - free;
    
    return {
      max,
      total,
      free,
      used,
      usagePercent: Math.round((used / max) * 100)
    };
  }
  
  // ========== App 信息 ==========
  
  async getAppInfo(): Promise<AppInfo> {
    const platform = typeof (window as any).DebugBridge !== 'undefined' ? 'android' : 'web';
    
    return {
      version: this.adapter.getAppVersion(),
      model: this.adapter.getDeviceModel(),
      os: this.adapter.getAndroidVersion(),
      platform
    };
  }
  
  // ========== 抓包 ==========
  
  async getRunningSnifferSessions(): Promise<string[]> {
    const sessionsJson = this.adapter.getRunningSnifferSessions();
    return JSON.parse(sessionsJson);
  }
  
  // ========== 工具方法 ==========
  
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
