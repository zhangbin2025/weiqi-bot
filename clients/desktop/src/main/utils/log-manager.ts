/**
 * 日志管理器
 * 
 * 对等 Android DebugBridge 日志功能
 */

import { createLogger } from './logger';

const log = createLogger('LogManager');

export interface LogEntry {
  timestamp: number;
  level: string;
  tag: string;
  message: string;
}

export class LogManager {
  private static instance: LogManager;
  private logs: LogEntry[] = [];
  private readonly maxLogs = 5000;

  static getInstance(): LogManager {
    if (!LogManager.instance) {
      LogManager.instance = new LogManager();
    }
    return LogManager.instance;
  }

  /**
   * 记录日志
   */
  log(level: string, tag: string, message: string): void {
    // 限制日志数量
    if (this.logs.length >= this.maxLogs) {
      this.logs.shift();
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      tag,
      message,
    };

    this.logs.push(entry);

    // 同时输出到控制台
    switch (level) {
      case 'ERROR':
        log.error(`[${tag}] ${message}`);
        break;
      case 'WARN':
        log.warn(`[${tag}] ${message}`);
        break;
      case 'INFO':
        log.info(`[${tag}] ${message}`);
        break;
      default:
        log.debug(`[${tag}] ${message}`);
    }
  }

  /**
   * 获取所有日志
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * 获取日志 JSON 字符串（对齐 Android DebugBridge.getLogs()）
   */
  getLogsJson(): string {
    // 格式: ["timestamp|level|tag|message", ...]
    const formatted = this.logs.map(entry => 
      `${entry.timestamp}|${entry.level}|${entry.tag}|${entry.message}`
    );
    return JSON.stringify(formatted);
  }

  /**
   * 清空日志
   */
  clearLogs(): void {
    this.logs = [];
    log.info('Logs cleared');
  }
}
