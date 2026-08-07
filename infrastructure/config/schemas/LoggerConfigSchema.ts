/**
 * Logger 模块配置模式
 * @description 定义 Logger 模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import { Platform } from '../interfaces';

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * 日志传输类型
 */
export enum LogTransportType {
  Console = 'console',
  Storage = 'storage',
  UI = 'ui',
  File = 'file',
}

/**
 * Logger 模块配置
 */
export interface ILoggerConfig {
  /** 日志级别 */
  level: LogLevel;

  /** 是否启用 */
  enabled: boolean;

  /** 传输适配器列表 */
  transports: LogTransportType[];

  /** 日志缓存大小 */
  cacheSize: number;

  /** 是否持久化日志 */
  persistLogs: boolean;

  /** 日志过期时间（毫秒） */
  logExpireTime: number;
}

/**
 * Logger 配置模式
 */
export const LoggerConfigSchema: IConfigSchemaDefinition<ILoggerConfig> = {
  level: {
    type: 'enum',
    enumValues: [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR],
    default: LogLevel.INFO,
    required: true,
    description: '日志级别',
    platformOverrides: {
      [Platform.Web]: LogLevel.DEBUG,
      [Platform.Server]: LogLevel.INFO,
      [Platform.MiniProgram]: LogLevel.INFO,
    },
  },
  enabled: {
    type: 'boolean',
    default: true,
    required: true,
    description: '是否启用日志',
  },
  transports: {
    type: 'array',
    default: [LogTransportType.Console],
    required: true,
    description: '传输适配器列表',
    items: {
      type: 'enum',
      enumValues: Object.values(LogTransportType),
    },
    minLength: 1,
    maxLength: 4,
    platformOverrides: {
      [Platform.Web]: [LogTransportType.Console, LogTransportType.UI],
      [Platform.Server]: [LogTransportType.Console, LogTransportType.File],
      [Platform.MiniProgram]: [LogTransportType.Console],
      [Platform.Mobile]: [LogTransportType.Console],
      [Platform.Desktop]: [LogTransportType.Console, LogTransportType.File],
    },
  },
  cacheSize: {
    type: 'number',
    default: 1000,
    required: true,
    description: '日志缓存大小（条数）',
    minValue: 100,
    maxValue: 10000,
    validate: (value: number) => value > 0 && value <= 10000,
  },
  persistLogs: {
    type: 'boolean',
    default: false,
    required: true,
    description: '是否持久化日志',
    platformOverrides: {
      [Platform.Server]: true, // 服务端默认持久化
    },
  },
  logExpireTime: {
    type: 'number',
    default: 7 * 24 * 60 * 60 * 1000, // 7天
    required: true,
    description: '日志过期时间（毫秒）',
    minValue: 60 * 60 * 1000, // 最小 1小时
    maxValue: 30 * 24 * 60 * 60 * 1000, // 最大 30天
  },
};
