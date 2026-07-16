/**
 * HTTP 响应接口
 * @description 定义 HTTP 响应的结构
 * @ai-example
 * const response: IResponse<Game[]> = {
 *   status: 200,
 *   statusText: 'OK',
 *   headers: {},
 *   data: [{ id: 1, name: 'Game 1' }],
 *   config: { url: '/api/games' },
 *   duration: 150,
 *   provider: 'DirectProvider'
 * };
 */

import type { IRequestConfig } from './IRequestConfig';

/**
 * HTTP 响应
 */
export interface IResponse<T = unknown> {
  /** 状态码 */
  status: number;

  /** 状态文本 */
  statusText: string;

  /** 响应头 */
  headers: Record<string, string>;

  /** 响应数据 */
  data: T;

  /** 请求配置 */
  config: IRequestConfig;

  /** 响应时间（毫秒） */
  duration: number;

  /** 提供者名称 */
  provider: string;

  /** 请求 ID */
  requestId?: string;

  /** 是否来自缓存 */
  fromCache?: boolean;

  /** 响应时间戳 */
  timestamp?: number;
}

/**
 * 响应包装器
 * @description 用于包装响应数据，提供额外信息
 */
export interface IResponseWrapper<T = unknown> {
  /** 响应数据 */
  data: T;

  /** 是否成功 */
  success: boolean;

  /** 错误信息（如果失败） */
  error?: string;

  /** 错误代码（如果失败） */
  errorCode?: string;

  /** 分页信息（如果是列表数据） */
  pagination?: {
    /** 当前页 */
    page: number;

    /** 每页数量 */
    pageSize: number;

    /** 总数量 */
    total: number;

    /** 总页数 */
    totalPages: number;
  };
}
