/**
 * 日志接口定义
 */

export interface ILoggerConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  enabled: boolean;
}

export interface ILogger {
  /** 日志器名称 */
  name: string;
  /** 调试日志 */
  debug(message: string, ...args: unknown[]): void;
  /** 信息日志 */
  info(message: string, ...args: unknown[]): void;
  /** 警告日志 */
  warn(message: string, ...args: unknown[]): void;
  /** 错误日志 */
  error(message: string, error?: Error | unknown): void;
  /** 添加上下文前缀，返回新的日志器实例 */
  withContext(context: string): ILogger;
  /** 设置日志级别 */
  setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void;
  /** 启用日志 */
  enable(): void;
  /** 禁用日志 */
  disable(): void;
  /** 获取当前配置 */
  getConfig(): ILoggerConfig;
}
