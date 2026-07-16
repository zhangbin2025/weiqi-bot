/**
 * 日志存储
 * @description 使用 LocalStorage 存储日志
 */

/**
 * 日志条目
 */
export interface LogEntry {
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  tag: string;
  message: string;
}

/**
 * 日志过滤器
 */
export interface LogFilter {
  level?: string;
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

/**
 * 日志存储
 * @description 使用 LocalStorage 持久化日志
 */
export class LogStorage {
  private static STORAGE_KEY = 'weiqi-debug-logs';
  private static MAX_LOGS = 1000;

  private logs: LogEntry[] = [];

  constructor() {
    this.loadFromStorage();
  }

  /**
   * 添加日志
   */
  addLog(log: LogEntry): void {
    this.logs.push(log);

    // 限制数量
    if (this.logs.length > LogStorage.MAX_LOGS) {
      this.logs.shift();
    }

    this.saveToStorage();
  }

  /**
   * 获取日志列表
   */
  getLogs(filter?: LogFilter): LogEntry[] {
    let result = [...this.logs];

    if (filter?.level) {
      result = result.filter(log => log.level === filter.level);
    }

    if (filter?.tag) {
      const tag = filter.tag;
      result = result.filter(log => log.tag.includes(tag));
    }

    if (filter?.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  /**
   * 清空日志
   */
  clearLogs(): void {
    this.logs = [];
    this.saveToStorage();
  }

  /**
   * 获取日志统计
   */
  getStats(): LogStats {
    return {
      total: this.logs.length,
      error: this.logs.filter(l => l.level === 'ERROR').length,
      warn: this.logs.filter(l => l.level === 'WARN').length,
      info: this.logs.filter(l => l.level === 'INFO').length,
      debug: this.logs.filter(l => l.level === 'DEBUG').length,
    };
  }

  /**
   * 从 LocalStorage 加载日志
   */
  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(LogStorage.STORAGE_KEY);
      if (data) {
        this.logs = JSON.parse(data);
      }
    } catch (error) {
      console.error('[LogStorage] Failed to load logs:', error);
      this.logs = [];
    }
  }

  /**
   * 保存日志到 LocalStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(LogStorage.STORAGE_KEY, JSON.stringify(this.logs));
    } catch (error) {
      // LocalStorage 可能已满，删除旧日志
      console.error('[LogStorage] Failed to save logs:', error);
      if (this.logs.length > 100) {
        this.logs = this.logs.slice(-100);
        try {
          localStorage.setItem(LogStorage.STORAGE_KEY, JSON.stringify(this.logs));
        } catch {
          // 完全失败，清空日志
          this.logs = [];
        }
      }
    }
  }
}
