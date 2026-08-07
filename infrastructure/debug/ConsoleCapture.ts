/**
 * Console 捕获器
 * @description 捕获 console.log/info/warn/error，存储到 LogStorage
 */

import { LogStorage, LogEntry } from './LogStorage';

/**
 * Console 捕获器
 * @description 劫持 console 方法，自动捕获日志
 */
export class ConsoleCapture {
  private static instance: ConsoleCapture | null = null;
  
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
  
  private storage: LogStorage;
  private enabled: boolean = true;

  private constructor(storage: LogStorage) {
    this.storage = storage;
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };
  }

  /**
   * 初始化 Console 捕获器
   */
  static init(storage: LogStorage): ConsoleCapture {
    if (this.instance) {
      return this.instance;
    }

    this.instance = new ConsoleCapture(storage);
    this.instance.install();
    return this.instance;
  }

  /**
   * 安装 console 劫持
   */
  private install(): void {
    const self = this;

    console.log = function(...args: any[]) {
      self.originalConsole.log(...args);
      self.capture('INFO', args);
    };

    console.info = function(...args: any[]) {
      self.originalConsole.info(...args);
      self.capture('INFO', args);
    };

    console.warn = function(...args: any[]) {
      self.originalConsole.warn(...args);
      self.capture('WARN', args);
    };

    console.error = function(...args: any[]) {
      self.originalConsole.error(...args);
      self.capture('ERROR', args);
    };

    console.debug = function(...args: any[]) {
      self.originalConsole.debug(...args);
      self.capture('DEBUG', args);
    };
  }

  /**
   * 捕获日志
   */
  private capture(level: LogEntry['level'], args: any[]): void {
    if (!this.enabled) return;

    try {
      const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');

      this.storage.addLog({
        timestamp: Date.now(),
        level,
        tag: 'Console',
        message,
      });
    } catch (error) {
      // 避免日志系统崩溃影响应用
      this.originalConsole.error('[ConsoleCapture] Failed to capture log:', error);
    }
  }

  /**
   * 启用捕获
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * 禁用捕获
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * 销毁捕获器（恢复原始 console）
   */
  destroy(): void {
    console.log = this.originalConsole.log;
    console.info = this.originalConsole.info;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    console.debug = this.originalConsole.debug;
    ConsoleCapture.instance = null;
  }
}
