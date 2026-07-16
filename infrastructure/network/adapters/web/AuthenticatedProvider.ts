/**
 * 认证网络提供者（付费通道）
 * @description 通过 API 服务器代理请求，自动携带认证 Token
 * @ai-example
 * const provider = new AuthenticatedProvider({
 *   apiUrl: 'https://api.example.com',
 *   authToken: 'user-token'
 * });
 * const response = await provider.request({ url: 'https://example.com/data' });
 */

import { BaseProvider } from '../common/BaseProvider';
import type {
  IRequestConfig,
  IResponse,
  IWebSocket,
  IWebSocketOptions,
  IUserContext,
  Environment
} from '../../interfaces';
import {
  NetworkError,
  TimeoutError,
  RequestError,
  AuthenticationError
} from '../../interfaces';
import type { IAuthenticatedProviderConfig } from './AuthenticatedProviderTypes';

/**
 * 认证提供者（付费通道）
 */
export class AuthenticatedProvider extends BaseProvider {
  private apiUrl: string;
  private userContext?: IUserContext | undefined;

  constructor(config: IAuthenticatedProviderConfig, userContext?: IUserContext) {
    super({
      name: 'AuthenticatedProvider',
      priority: 30,
      supportedEnvironments: config.supportedEnvironments ?? [
        'web' as Environment,
        'desktop' as Environment,
        'mobile' as Environment,
        'miniprogram' as Environment
      ],
      timeout: config.timeout ?? 30000
    });
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.userContext = userContext;
  }

  /** 发起 HTTP 请求 */
  async request<T>(config: IRequestConfig): Promise<IResponse<T>> {
    const startTime = Date.now();
    const timeout = config.timeout ?? this.timeout;
    const token = await this.getAuthToken();

    if (!token) {
      throw new AuthenticationError('No authentication token available', this.name, config);
    }

    const url = this.buildProxyUrl(config.url);
    const headers = this.mergeHeadersWithAuth(config, token);

    try {
      const response = await this.requestWithTimeout(
        fetch(url, {
          method: config.method ?? 'GET',
          headers,
          body: config.data ? JSON.stringify(config.data) : null,
          credentials: 'include',
          cache: 'no-store' // 禁用 HTTP 缓存，使用业务层缓存（IndexedDB）
        }),
        timeout
      );

      const duration = Date.now() - startTime;
      this.validateResponse(response, config);
      const data = await this.parseResponse<T>(response, config.responseType);

      return {
        status: response.status,
        statusText: response.statusText,
        headers: this.extractHeaders(response.headers),
        data,
        config,
        duration,
        provider: this.name,
        timestamp: Date.now()
      };
    } catch (error) {
      throw this.handleError(error, timeout, config);
    }
  }

  /** 建立 WebSocket 连接（通过代理） */
  async connect(url: string, options?: IWebSocketOptions): Promise<IWebSocket> {
    const proxyWsUrl = this.buildProxyUrl(url);
    const token = await this.getAuthToken();
    const timeout = options?.timeout ?? 10000;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(proxyWsUrl, (options?.protocols as string[] | undefined));
      const timer = setTimeout(() => {
        ws.close();
        reject(new TimeoutError(timeout, this.name));
      }, timeout);

      ws.onopen = () => {
        clearTimeout(timer);
        if (token) ws.send(JSON.stringify({ type: 'auth', token }));
        resolve(this.createWebSocketWrapper(ws));
      };

      ws.onerror = () => {
        clearTimeout(timer);
        reject(new NetworkError('WebSocket proxy failed', 'WS_PROXY_ERROR', this.name));
      };
    });
  }

  private async getAuthToken(): Promise<string | null> {
    return this.userContext?.getAuthToken() ?? null;
  }

  private buildProxyUrl(originalUrl: string): string {
    return `${this.apiUrl}/api/v1/fetch?url=${encodeURIComponent(originalUrl)}`;
  }

  private mergeHeadersWithAuth(config: IRequestConfig, token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...config.headers
    };
  }

  private validateResponse(response: Response, config: IRequestConfig): void {
    if (response.status === 401) {
      throw new AuthenticationError('Authentication failed', this.name, config);
    }
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
      default: return await response.json();
    }
  }

  private extractHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => { result[key] = value; });
    return result;
  }

  private handleError(error: unknown, timeout: number, config: IRequestConfig): Error {
    if (error instanceof RequestError || error instanceof AuthenticationError) return error;
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return new TimeoutError(timeout, this.name, config);
      }
      return new NetworkError(error.message, 'NETWORK_ERROR', this.name, config);
    }
    return new NetworkError('Unknown error', 'UNKNOWN_ERROR', this.name, config);
  }

  private createWebSocketWrapper(ws: WebSocket): IWebSocket {
    return {
      get readyState() { return ws.readyState; },
      get url() { return ws.url; },
      send: (data: string | ArrayBuffer) => ws.send(data),
      close: () => ws.close(),
      onMessage: (cb) => { ws.onmessage = (e) => cb({ data: e.data, type: 'message', timestamp: Date.now() }); },
      onError: (cb) => { ws.onerror = () => cb(new Error('WebSocket error')); },
      onClose: (cb) => { ws.onclose = () => cb(); },
      onOpen: (cb) => { ws.onopen = () => cb(); }
    };
  }
}
