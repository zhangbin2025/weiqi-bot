/**
 * HTTP Sniffer Provider - HTTP 事件处理器
 * 
 * 职责：
 * 1. 处理 HTTP 事件（http_request, http_response, http_error）
 * 2. 提供 HTTP URL 过滤功能
 * 3. 提供 HTTP 响应数据提取工具
 * 
 * 设计原则：
 * - 作为辅助类，不实现 ISnifferProvider 接口
 * - 提供静态方法，供其他 Provider 使用
 */

import type { SnifferMessage, HttpResponseData } from '../../interfaces/SnifferTypes';

/**
 * HTTP Sniffer 配置选项
 */
export interface HttpSnifferOptions {
  /** HTTP URL 过滤模式（正则表达式字符串） */
  httpPattern?: string;
  /** 最大响应体大小（字节），超过则不读取 */
  maxBodySize?: number;
}

/**
 * HTTP Sniffer Provider
 */
export class HttpSnifferProvider {
  /**
   * 过滤 HTTP 消息
   * @param messages 所有消息
   * @param options 过滤选项
   * @returns 过滤后的 HTTP 响应消息
   */
  static filterHttpResponses(
    messages: SnifferMessage[],
    options: HttpSnifferOptions = {}
  ): HttpResponseData[] {
    const httpResponses: HttpResponseData[] = [];

    for (const msg of messages) {
      // 只处理 HTTP 响应
      if (msg.type !== 'http_response') continue;

      const httpMsg = msg as HttpResponseData;

      // 如果指定了 httpPattern，进行 URL 过滤
      if (options.httpPattern) {
        try {
          const regex = new RegExp(options.httpPattern);
          if (!regex.test(httpMsg.url)) continue;
        } catch (e) {
          console.error('[HttpSniffer] Invalid httpPattern:', options.httpPattern, e);
          continue;
        }
      }

      // 过滤掉过大的响应体
      if (options.maxBodySize && httpMsg.body && httpMsg.body.length > options.maxBodySize) {
        continue;
      }

      httpResponses.push(httpMsg);
    }

    return httpResponses;
  }

  /**
   * 从 HTTP 响应中提取 JSON 数据
   * @param response HTTP 响应
   * @returns JSON 数据，如果解析失败返回 null
   */
  static extractJson<T = any>(response: HttpResponseData): T | null {
    if (!response.body) return null;

    try {
      return JSON.parse(response.body) as T;
    } catch (e) {
      console.error('[HttpSniffer] Failed to parse JSON:', e);
      return null;
    }
  }

  /**
   * 从 HTTP 响应中提取文本数据
   * @param response HTTP 响应
   * @returns 文本数据，如果没有返回 null
   */
  static extractText(response: HttpResponseData): string | null {
    return response.body || null;
  }

  /**
   * 检查 HTTP 响应是否成功（状态码 2xx）
   * @param response HTTP 响应
   * @returns 是否成功
   */
  static isSuccess(response: HttpResponseData): boolean {
    return response.status >= 200 && response.status < 300;
  }

  /**
   * 检查 HTTP 响应是否包含特定内容
   * @param response HTTP 响应
   * @param pattern 正则表达式或字符串
   * @returns 是否包含
   */
  static contains(response: HttpResponseData, pattern: string | RegExp): boolean {
    if (!response.body) return false;

    try {
      if (typeof pattern === 'string') {
        return response.body.includes(pattern);
      } else {
        return pattern.test(response.body);
      }
    } catch (e) {
      return false;
    }
  }

  /**
   * 批量提取 HTTP 响应中的 JSON 数据
   * @param responses HTTP 响应列表
   * @returns JSON 数据列表（过滤掉 null）
   */
  static extractAllJson<T = any>(responses: HttpResponseData[]): T[] {
    const results: T[] = [];

    for (const response of responses) {
      const json = this.extractJson<T>(response);
      if (json !== null) {
        results.push(json);
      }
    }

    return results;
  }

  /**
   * 按状态码过滤 HTTP 响应
   * @param responses HTTP 响应列表
   * @param statusCodes 状态码列表
   * @returns 过滤后的响应列表
   */
  static filterByStatus(
    responses: HttpResponseData[],
    statusCodes: number[]
  ): HttpResponseData[] {
    return responses.filter(r => statusCodes.includes(r.status));
  }

  /**
   * 按 URL 过滤 HTTP 响应
   * @param responses HTTP 响应列表
   * @param urlPattern URL 匹配模式（字符串或正则）
   * @returns 过滤后的响应列表
   */
  static filterByUrl(
    responses: HttpResponseData[],
    urlPattern: string | RegExp
  ): HttpResponseData[] {
    return responses.filter(r => {
      try {
        if (typeof urlPattern === 'string') {
          return r.url.includes(urlPattern);
        } else {
          return urlPattern.test(r.url);
        }
      } catch (e) {
        return false;
      }
    });
  }
}
