import type { IResponse } from './IResponse';
/**
 * HTTP 请求配置接口
 * @description 定义 HTTP 请求的所有配置项
 * @ai-example
 * const config: IRequestConfig = {
 *   url: '/api/games',
 *   method: 'GET',
 *   headers: { 'Authorization': 'Bearer token' }
 * };
 */

/**
 * HTTP 请求方法
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * 响应数据类型
 */
export type ResponseType = 'json' | 'text' | 'blob' | 'arraybuffer';

/**
 * HTTP 请求配置
 */
export interface IRequestConfig {
  /** 请求 URL（相对或绝对路径） */
  url: string;

  /** 请求方法 */
  method?: HttpMethod | undefined;

  /** 请求头 */
  headers?: Record<string, string> | undefined;

  /** 请求参数（query string） */
  params?: Record<string, string | number | boolean> | undefined;

  /** 请求体 */
  data?: unknown | undefined;

  /** 超时时间（毫秒） */
  timeout?: number | undefined;

  /** 重试次数 */
  retry?: number | undefined;

  /** 是否需要认证 */
  requireAuth?: boolean | undefined;

  /** 响应数据类型 */
  responseType?: ResponseType | undefined;

  /** 自定义元数据 */
  metadata?: Record<string, unknown> | undefined;

  /** 请求 ID（用于追踪） */
  requestId?: string | undefined;

  /** 是否允许缓存 */
  enableCache?: boolean | undefined;

  /** 进度回调（用于下载大文件） */
  onProgress?: ((loaded: number, total: number, progress: number) => void) | undefined;

  /** 期望的文件大小（字节），用于进度计算（当 content-length 不可用时） */
  expectedSize?: number | undefined;

  /** 重试次数（用于请求） */
  retryCount?: number | undefined;

  /** 绕过代理，强制使用直连（适用于需要获取真实客户端 IP 的请求，如 IP 定位） */
  bypassProxy?: boolean | undefined;
}

/**
 * 请求拦截器接口
 * @description 用于在请求发送前修改请求配置
 */
export interface IRequestInterceptor {
  /**
   * 拦截请求
   * @param config - 原始请求配置
   * @returns 修改后的请求配置
   */
  intercept(config: IRequestConfig): IRequestConfig | Promise<IRequestConfig>;
}

/**
 * 响应拦截器接口
 * @description 用于在响应返回后处理响应数据
 */
export interface IResponseInterceptor {
  /**
   * 拦截响应
   * @param response - 原始响应
   * @returns 处理后的响应
   */
  intercept<T>(response: IResponse<T>): IResponse<T> | Promise<IResponse<T>>;
}
