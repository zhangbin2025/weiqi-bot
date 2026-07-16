/**
 * 浏览器代理网络提供者
 * @description 通过代理服务器解决 CORS 问题
 * @ai-example
 * const provider = new ProxyProvider({
 *   proxyUrl: 'https://proxy.example.com'
 * });
 * const response = await provider.request({ url: '/api/games' });
 */

import { BaseProvider } from '../common/BaseProvider';
import type {
  IRequestConfig,
  IResponse,
  IWebSocket,
  IWebSocketOptions
} from '../../interfaces';
import {
  NetworkError,
  TimeoutError,
  RequestError,
  Environment
} from '../../interfaces';
import type { IProxyProviderConfig } from './ProxyProviderTypes';
import { createWebSocketWrapper, extractHeaders } from './ProxyProviderUtils';

/**
 * 浏览器代理提供者
 */
export class ProxyProvider extends BaseProvider {
  private proxyUrl: string;
  private enabled: boolean;

  constructor(config: IProxyProviderConfig) {
    super({
      name: 'ProxyProvider',
      priority: 20,
      supportedEnvironments: [Environment.WEB, Environment.MOBILE]
    });

    this.proxyUrl = config.proxyUrl;
    this.enabled = config.enabled ?? true;
  }

  /**
   * 检测是否为 App 环境（通过 User Agent 判断）
   */
  private isAppEnvironment(): boolean {
    return typeof navigator !== 'undefined' && 
           navigator.userAgent.includes('WeiqiApp');
  }

  /**
   * 发起 HTTP 请求
   */
  async request<T>(config: IRequestConfig): Promise<IResponse<T>> {
    if (!this.enabled) {
      throw new NetworkError(
        'Proxy is disabled',
        'PROXY_DISABLED',
        this.name,
        config
      );
    }

    const startTime = Date.now();
    const url = this.buildProxyUrl(config.url);
    const headers = this.mergeHeaders(config);
    const timeout = config.timeout ?? this.timeout;

    try {
      const response = await this.executeRequest<T>(
        config, url, headers, timeout
      );
      return response;
    } catch (error) {
      throw this.handleError(error, timeout, config);
    }
  }

  /**
   * 建立 WebSocket 连接
   */
  async connect(url: string, options?: IWebSocketOptions): Promise<IWebSocket> {
    const proxyWsUrl = this.buildProxyUrl(url);
    return this.createWsConnection(proxyWsUrl, options);
  }

  private async executeRequest<T>(
    config: IRequestConfig,
    url: string,
    headers: Record<string, string>,
    timeout: number
  ): Promise<IResponse<T>> {
    const startTime = Date.now();
    const fetchOptions = this.buildFetchOptions(config, headers);
    const useAssetServer = this.isAppEnvironment();

    const response = await this.requestWithTimeout(
      fetch(url, fetchOptions),
      timeout
    );

    const duration = Date.now() - startTime;
    this.validateResponse(response, config);

    const data = await this.parseResponse<T>(response, config.responseType);

    return {
      status: response.status,
      statusText: response.statusText,
      headers: extractHeaders(response.headers, useAssetServer),
      data,
      config,
      duration,
      provider: this.name,
      timestamp: Date.now()
    };
  }

  private buildFetchOptions(
    config: IRequestConfig,
    headers: Record<string, string>
  ): RequestInit {
    const processedHeaders = { ...headers };
    
    // 检测是否需要 credentials
    const hasAuth = headers['Authorization'] != null || config.headers?.['Authorization'] != null;
    const hasCookie = headers['Cookie'] != null || headers['cookie'] != null || 
                      config.headers?.['Cookie'] != null || config.headers?.['cookie'] != null;
    
    // App 环境下的请求头转换（AssetServer 支持 X- 前缀）
    if (this.isAppEnvironment()) {
      // Cookie 头转换
      if (hasCookie) {
        const cookieValue = headers['Cookie'] || headers['cookie'] || 
                            config.headers?.['Cookie'] || config.headers?.['cookie'];
        if (cookieValue) {
          delete processedHeaders['Cookie'];
          delete processedHeaders['cookie'];
          processedHeaders['X-Cookie'] = cookieValue;
        }
      }
      
      // X-User-Agent 和 X-Referer 已经在 YichafenClient 中设置，直接透传
    }
    
    // 根据 Content-Type 决定如何处理 body
    let body: string | null = null;
    if (config.data) {
      const contentType = headers['Content-Type'] || config.headers?.['Content-Type'];
      
      // 对于 application/x-www-form-urlencoded，直接使用原始数据（如果已经是字符串）
      if (contentType?.includes('application/x-www-form-urlencoded') && typeof config.data === 'string') {
        body = config.data;
      } else {
        // 对于 JSON 或其他类型，使用 JSON.stringify
        body = JSON.stringify(config.data);
      }
    }
    
    // CORS 规范：credentials: 'include' 和 Access-Control-Allow-Origin: * 冲突
    // 只有在有 Authorization 或 Cookie 时才使用 'include'
    const credentials = (hasAuth || hasCookie) ? 'include' : 'omit';
    
    return {
      method: config.method ?? 'GET',
      headers: processedHeaders,
      body,
      credentials,
      cache: 'no-store', // 禁用 HTTP 缓存，使用业务层缓存（IndexedDB）
    };
  }

  private validateResponse(response: Response, config: IRequestConfig): void {
    if (!response.ok) {
      throw new RequestError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        this.name,
        config
      );
    }
  }

  private async parseResponse<T>(
    response: Response,
    responseType?: 'json' | 'text' | 'blob' | 'arraybuffer'
  ): Promise<T> {
    const type = responseType ?? 'json';
    switch (type) {
      case 'text': return (await response.text()) as T;
      case 'blob': return (await response.blob()) as T;
      case 'arraybuffer': return (await response.arrayBuffer()) as T;
      default:
        const text = await response.text();
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as T;
        }
    }
  }

  private handleError(error: unknown, timeout: number, config: IRequestConfig): Error {
    if (error instanceof RequestError) return error;
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return new TimeoutError(timeout, this.name, config);
      }
      return new NetworkError(error.message, 'NETWORK_ERROR', this.name, config);
    }
    return new NetworkError('Unknown error', 'UNKNOWN_ERROR', this.name, config);
  }

  private async createWsConnection(
    proxyWsUrl: string,
    options?: IWebSocketOptions
  ): Promise<IWebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(proxyWsUrl, (options?.protocols as string[] | undefined));
      const timeout = options?.timeout ?? 10000;
      const timer = setTimeout(() => {
        ws.close();
        reject(new TimeoutError(timeout, this.name));
      }, timeout);

      ws.onopen = () => {
        clearTimeout(timer);
        resolve(createWebSocketWrapper(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new NetworkError('WS proxy failed', 'WS_PROXY_ERROR', this.name));
      };
    });
  }

  private buildProxyUrl(originalUrl: string): string {
    // 如果 URL 已经是本代理平台的地址，直接返回，避免双重代理
    if (originalUrl.includes(this.proxyUrl.replace('https://', '').replace('http://', ''))) {
      return originalUrl;
    }
    
    if (originalUrl.startsWith('http://') || originalUrl.startsWith('https://')) {
      return `${this.proxyUrl}/?url=${encodeURIComponent(originalUrl)}`;
    }
    
    // 相对路径：先解析成绝对路径（相对于当前页面），再代理
    if (originalUrl.startsWith('/') || originalUrl.startsWith('.') || !originalUrl.includes('://')) {
      const absoluteUrl = new URL(originalUrl, window.location.origin + window.location.pathname).toString();
      return `${this.proxyUrl}/?url=${encodeURIComponent(absoluteUrl)}`;
    }
    
    return `${this.proxyUrl}${originalUrl}`;
  }
}