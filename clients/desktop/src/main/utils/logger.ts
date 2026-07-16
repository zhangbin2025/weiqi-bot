/**
 * 日志工具
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  debug(message: string, ...args: any[]) {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[${this.context}] [DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.level <= LogLevel.INFO) {
      console.log(`[${this.context}] [INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[${this.context}] [WARN] ${message}`, ...args);
    }
  }

  error(message: string, error?: any) {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[${this.context}] [ERROR] ${message}`, error || '');
      if (error?.stack) {
        console.error(error.stack);
      }
    }
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}
