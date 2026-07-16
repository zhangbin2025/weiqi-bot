/**
 * 请求构建器工厂
 * @description 提供便捷的静态工厂方法来创建请求配置
 */

import type { IRequestConfig, HttpMethod } from '../../interfaces';
import { RequestBuilder } from './RequestBuilder';

/**
 * 创建 GET 请求构建器
 */
export function getRequest(url: string): RequestBuilder {
  return new RequestBuilder().url(url).method('GET');
}

/**
 * 创建 POST 请求构建器
 */
export function postRequest(url: string, data?: unknown): RequestBuilder {
  const builder = new RequestBuilder().url(url).method('POST');
  if (data) builder.data(data);
  return builder;
}

/**
 * 创建 PUT 请求构建器
 */
export function putRequest(url: string, data?: unknown): RequestBuilder {
  const builder = new RequestBuilder().url(url).method('PUT');
  if (data) builder.data(data);
  return builder;
}

/**
 * 创建 DELETE 请求构建器
 */
export function deleteRequest(url: string): RequestBuilder {
  return new RequestBuilder().url(url).method('DELETE');
}

/**
 * 创建 PATCH 请求构建器
 */
export function patchRequest(url: string, data?: unknown): RequestBuilder {
  const builder = new RequestBuilder().url(url).method('PATCH');
  if (data) builder.data(data);
  return builder;
}

/**
 * 从现有配置创建构建器
 */
export function fromConfig(config: IRequestConfig): RequestBuilder {
  const builder = new RequestBuilder();
  (builder as any).config = { ...config };
  return builder;
}