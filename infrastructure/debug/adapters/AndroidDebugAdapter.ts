/**
 * Android 平台调试适配器
 * @module infrastructure/debug/adapters/AndroidDebugAdapter
 * 
 * 通过 prompt() API 调用 MainActivity 的调试接口
 */

import type { IDebugAdapter } from './IDebugAdapter';

/**
 * Android 调试接口
 * 通过 prompt() API 调用 MainActivity 的 handleDebugPrompt
 */
export class AndroidDebugAdapter implements IDebugAdapter {
  // 日志
  getLogs(): string {
    return prompt('debug:getLogs', '') || '[]';
  }
  
  clearLogs(): void {
    prompt('debug:clearLogs', '');
  }
  
  // 存储
  getFilesDir(): string {
    return prompt('debug:getFilesDir', '') || '';
  }
  
  getCacheDir(): string {
    return prompt('debug:getCacheDir', '') || '';
  }
  
  getFileSize(path: string): number {
    const result = prompt('debug:getFileSize', path);
    return result ? parseInt(result) : 0;
  }
  
  listFiles(path: string): string {
    return prompt('debug:listFiles', path) || '[]';
  }
  
  deleteFile(path: string): boolean {
    const result = prompt('debug:deleteFile', path);
    return result === 'true';
  }
  
  // 性能
  getMaxMemory(): number {
    const result = prompt('debug:getMaxMemory', '');
    return result ? parseInt(result) : 0;
  }
  
  getTotalMemory(): number {
    const result = prompt('debug:getTotalMemory', '');
    return result ? parseInt(result) : 0;
  }
  
  getFreeMemory(): number {
    const result = prompt('debug:getFreeMemory', '');
    return result ? parseInt(result) : 0;
  }
  
  getCurrentTime(): number {
    const result = prompt('debug:getCurrentTime', '');
    return result ? parseInt(result) : 0;
  }
  
  // 抓包
  getRunningSnifferSessions(): string {
    return prompt('debug:getRunningSnifferSessions', '') || '[]';
  }
  
  // App 信息
  getAppVersion(): string {
    return prompt('debug:getAppVersion', '') || 'unknown';
  }
  
  getDeviceModel(): string {
    return prompt('debug:getDeviceModel', '') || 'unknown';
  }
  
  getAndroidVersion(): string {
    return prompt('debug:getAndroidVersion', '') || 'unknown';
  }
}
