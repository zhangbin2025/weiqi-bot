/**
 * 调试适配器接口
 * @module infrastructure/debug/adapters/IDebugAdapter
 * 
 * 定义所有平台必须实现的底层接口
 */

/**
 * 调试适配器接口
 */
export interface IDebugAdapter {
  // 日志
  getLogs(): string | Promise<string>;
  clearLogs(): void;
  
  // 存储
  getFilesDir(): string;
  getCacheDir(): string;
  getFileSize(path: string): number;
  listFiles(path: string): string;
  deleteFile(path: string): boolean;
  
  // 性能
  getMaxMemory(): number;
  getTotalMemory(): number;
  getFreeMemory(): number;
  getCurrentTime(): number;
  
  // 抓包
  getRunningSnifferSessions(): string;
  
  // App 信息
  getAppVersion(): string;
  getDeviceModel(): string;
  getAndroidVersion(): string;
}
