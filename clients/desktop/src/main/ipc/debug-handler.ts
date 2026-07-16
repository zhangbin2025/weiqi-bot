/**
 * 调试桥接处理器
 * 
 * 对等 Android DebugBridgeHandler
 * 处理 debug:* 前缀的桥接消息
 */

import { app } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../config';
import { LogManager } from '../utils/log-manager';

export class DebugHandler {
  readonly prefix = 'debug:';

  handle(message: string): string {
    const parts = message.split(':');
    if (parts.length < 2) {
      return JSON.stringify({ error: 'Invalid format' });
    }

    const action = parts[1];
    const arg = parts.length >= 3 ? parts[2] : '';

    return this.handleAction(action, arg);
  }

  private handleAction(action: string, arg: string): string {
    switch (action) {
      // 日志接口
      case 'getLogs':
        return LogManager.getInstance().getLogsJson();

      case 'clearLogs':
        LogManager.getInstance().clearLogs();
        return 'ok';

      // 存储接口
      case 'getFilesDir':
        return app.getPath('userData');

      case 'getCacheDir':
        return app.getPath('temp');

      case 'getFileSize':
        return this.getFileSize(arg).toString();

      case 'clearCache':
        return this.clearCache().toString();

      case 'getGeckoStorageSize':
        // 对等 Android: 计算 web 缓存目录大小
        return this.getGeckoStorageSize().toString();

      case 'getMaxMemory':
        // 返回 Node.js 进程内存限制（对齐 Android Runtime.getRuntime().maxMemory()）
        const heapStats = process.memoryUsage();
        return Math.floor(heapStats.rss / 1024 / 1024).toString();

      case 'getTotalMemory':
        return (os.totalmem() / 1024 / 1024).toFixed(0);

      case 'getFreeMemory':
        return (os.freemem() / 1024 / 1024).toFixed(0);

      case 'getCurrentTime':
        return Date.now().toString();

      case 'getAppVersion':
        return app.getVersion();

      case 'getDeviceModel':
        return `${os.type()} ${os.release()} ${os.arch()}`;

      case 'getAndroidVersion':
        return `Electron ${process.versions.electron}, Node ${process.versions.node}`;

      case 'getRunningSnifferSessions':
        // Desktop 端暂无抓包 session 管理，返回空数组
        return '[]';

      case 'listFiles':
        return this.listFiles(arg);

      case 'deleteFile':
        return this.deleteFile(arg).toString();

      case 'refresh':
        // 刷新当前页面（通过返回特殊标记让主进程处理）
        return 'refresh';

      default:
        return JSON.stringify({ error: `Unknown action: ${action}` });
    }
  }

  private getFileSize(filePath: string): number {
    try {
      const fullPath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(app.getPath('userData'), filePath);
      
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        return stats.isDirectory() 
          ? this.getDirSize(fullPath) 
          : stats.size;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  private getDirSize(dirPath: string): number {
    let size = 0;
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        size += stats.isDirectory() ? this.getDirSize(filePath) : stats.size;
      }
    } catch {}
    return size;
  }

  private clearCache(): boolean {
    try {
      // 1. 清空 Electron session 缓存（对齐 Android GeckoView clearData）
      const { session } = require('electron');
      const ses = session.defaultSession;
      ses.clearCache();
      ses.clearStorageData();
      
      // 2. 清空临时目录
      const cacheDir = app.getPath('temp');
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir);
        for (const file of files) {
          const filePath = path.join(cacheDir, file);
          try {
            fs.rmSync(filePath, { recursive: true, force: true });
          } catch (e) {
            // 忽略删除失败的文件
          }
        }
      }
      
      console.log('[DebugHandler] Cache cleared');
      return true;
    } catch (error) {
      console.error('[DebugHandler] Failed to clear cache:', error);
      return false;
    }
  }

  /**
   * 计算 web 缓存目录大小（对等 Android getGeckoStorageSize）
   * Electron 缓存包括：session cache + userData 目录
   */
  private getGeckoStorageSize(): number {
    try {
      let totalSize = 0;
      
      // 1. 计算 userData 目录大小
      const userDataDir = app.getPath('userData');
      if (fs.existsSync(userDataDir)) {
        totalSize += this.getDirSize(userDataDir);
      }
      
      // 2. 计算临时目录大小
      const tempDir = app.getPath('temp');
      if (fs.existsSync(tempDir)) {
        totalSize += this.getDirSize(tempDir);
      }
      
      return totalSize;
    } catch {
      return 0;
    }
  }

  private listFiles(dirPath: string): string {
    try {
      const fullPath = path.isAbsolute(dirPath)
        ? dirPath
        : path.join(app.getPath('userData'), dirPath);
      
      if (!fs.existsSync(fullPath)) {
        return JSON.stringify([]);
      }

      const files = fs.readdirSync(fullPath).map(name => {
        const filePath = path.join(fullPath, name);
        const stats = fs.statSync(filePath);
        return {
          name,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          modified: stats.mtimeMs,
        };
      });

      return JSON.stringify(files);
    } catch {
      return JSON.stringify([]);
    }
  }

  private deleteFile(filePath: string): boolean {
    try {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(app.getPath('userData'), filePath);
      
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
