/**
 * 请求构建器
 * @description 提供便捷的方法来构建 HTTP 请求配置
 * @ai-example
 * const config = new RequestBuilder()
 *   .url('/api/games').method('GET')
 *   .header('Authorization', 'Bearer token')
 *   .param('limit', 10).build();
 */

import type { IRequestConfig, HttpMethod } from '../../interfaces';

/** 请求构建器 */
export class RequestBuilder {
  protected config: Partial<IRequestConfig> = {};

  url(url: string): this {
    this.config.url = url;
    return this;
  }

  method(method: HttpMethod): this {
    this.config.method = method;
    return this;
  }

  header(key: string, value: string): this {
    this.config.headers = { ...this.config.headers, [key]: value };
    return this;
  }

  headers(headers: Record<string, string>): this {
    this.config.headers = { ...this.config.headers, ...headers };
    return this;
  }

  param(key: string, value: string | number | boolean): this {
    this.config.params = { ...this.config.params, [key]: value };
    return this;
  }

  params(params: Record<string, string | number | boolean>): this {
    this.config.params = { ...this.config.params, ...params };
    return this;
  }

  data(data: unknown): this {
    this.config.data = data;
    return this;
  }

  timeout(timeout: number): this {
    this.config.timeout = timeout;
    return this;
  }

  retry(retry: number): this {
    this.config.retry = retry;
    return this;
  }

  requireAuth(requireAuth: boolean): this {
    this.config.requireAuth = requireAuth;
    return this;
  }

  responseType(type: 'json' | 'text' | 'blob' | 'arraybuffer'): this {
    this.config.responseType = type;
    return this;
  }

  requestId(requestId: string): this {
    this.config.requestId = requestId;
    return this;
  }

  metadata(metadata: Record<string, unknown>): this {
    this.config.metadata = metadata;
    return this;
  }

  enableCache(enable: boolean): this {
    this.config.enableCache = enable;
    return this;
  }

  build(): IRequestConfig {
    if (!this.config.url) {
      throw new Error('URL is required');
    }
    return this.config as IRequestConfig;
  }

  reset(): this {
    this.config = {};
    return this;
  }

  // ==================== 静态方法 ====================

  static get(url: string): RequestBuilder {
    return new RequestBuilder().url(url).method('GET');
  }

  static post(url: string, data?: unknown): RequestBuilder {
    const builder = new RequestBuilder().url(url).method('POST');
    if (data !== undefined) builder.data(data);
    return builder;
  }

  static put(url: string, data?: unknown): RequestBuilder {
    const builder = new RequestBuilder().url(url).method('PUT');
    if (data !== undefined) builder.data(data);
    return builder;
  }

  static delete(url: string): RequestBuilder {
    return new RequestBuilder().url(url).method('DELETE');
  }

  static from(config: Partial<IRequestConfig>): RequestBuilder {
    const builder = new RequestBuilder();
    builder.config = { ...config };
    return builder;
  }
}