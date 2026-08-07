/**
 * 网络日志类型定义
 */

import type { IRequestConfig, IResponse } from '../../interfaces';

/**
 * 网络日志条目
 */
export interface INetworkLogEntry {
  /** 日志 ID */
  id: string;

  /** 请求时间戳 */
  timestamp: number;

  /** 请求配置 */
  request: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    data?: unknown;
  };

  /** 响应信息 */
  response?: {
    status: number;
    statusText: string;
    duration: number;
    size?: number;
  };

  /** 错误信息 */
  error?: {
    message: string;
    code: string;
    stack?: string;
  };

  /** 提供者名称 */
  provider: string;

  /** 是否成功 */
  success: boolean;
}

/**
 * 网络日志配置
 */
export interface INetworkLoggerConfig {
  /** 是否启用日志 */
  enabled?: boolean;

  /** 最大日志条数 */
  maxEntries?: number;

  /** 是否记录请求头 */
  logHeaders?: boolean;

  /** 是否记录请求体 */
  logRequestBody?: boolean;

  /** 是否记录响应体 */
  logResponseBody?: boolean;

  /** 日志级别 */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';

  /** 自定义日志处理器 */
  customHandler?: (entry: INetworkLogEntry) => void;
}

/**
 * 网络日志查询选项
 */
export interface INetworkLogQueryOptions {
  /** 开始时间 */
  startTime?: number;

  /** 结束时间 */
  endTime?: number;

  /** URL 模式 */
  urlPattern?: string;

  /** 请求方法 */
  method?: string;

  /** 是否成功 */
  success?: boolean;

  /** 提供者名称 */
  provider?: string;

  /** 限制数量 */
  limit?: number;
}
