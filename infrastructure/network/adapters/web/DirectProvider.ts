/**
 * 浏览器直连网络提供者
 * @description 使用 fetch API 进行网络请求，受 CORS 限制
 * @ai-example
 * const provider = new DirectProvider();
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

/**
 * 浏览器直连提供者
 */
export class DirectProvider extends BaseProvider {
  constructor() {
    super({
      name: 'DirectProvider',
      priority: 10,
      supportedEnvironments: [
        Environment.WEB,
        Environment.DESKTOP,
        Environment.MOBILE
      ]
    });
  }

  /**
   * 发起 HTTP 请求
   */
  async request<T>(config: IRequestConfig): Promise<IResponse<T>> {
    const startTime = Date.now();
    const url = this.buildUrl(config);
    const headers = this.mergeHeaders(config);
    const timeout = config.timeout ?? this.timeout;

    const needsAuth = headers['Authorization'] != null || config.headers?.['Authorization'] != null;
    const fetchOptions: RequestInit = {
      method: config.method ?? 'GET',
      headers,
      body: this.buildBody(config),
      credentials: needsAuth ? 'include' : 'omit',
      cache: 'no-store', // 禁用 HTTP 缓存，使用业务层缓存（IndexedDB）
    };

    try {
      const response = await this.requestWithTimeout(
        fetch(url, fetchOptions),
        timeout
      );

      const duration = Date.now() - startTime;

      if (!response.ok) {
        throw new RequestError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          this.name,
          config
        );
      }

      let data: T;
      const responseType = config.responseType ?? 'json';

      switch (responseType) {
        case 'text':
          data = (await response.text()) as T;
          break;
        case 'blob':
          // 支持 onProgress 进度回调
          if (config.onProgress && response.body) {
            data = (await this.readBlobWithProgress(response, config)) as T;
          } else {
            data = (await response.blob()) as T;
          }
          break;
        case 'arraybuffer':
          data = (await response.arrayBuffer()) as T;
          break;
        default:
          // 先读 text，再尝试 JSON 解析，避免非 JSON 响应（如代理返回 HTML）导致崩溃
          const text = await response.text();
          try {
            data = JSON.parse(text) as T;
          } catch {
            data = text as T;
          }
      }

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
      if (error instanceof RequestError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new TimeoutError(timeout, this.name, config);
        }
        throw new NetworkError(
          error.message,
          'NETWORK_ERROR',
          this.name,
          config
        );
      }

      throw new NetworkError(
        'Unknown network error',
        'UNKNOWN_ERROR',
        this.name,
        config
      );
    }
  }

  /**
   * 建立 WebSocket 连接
   */
  async connect(
    url: string,
    options?: IWebSocketOptions
  ): Promise<IWebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, (options?.protocols as string[] | undefined));

      const timeout = options?.timeout ?? 10000;
      const timer = setTimeout(() => {
        ws.close();
        reject(new TimeoutError(timeout, this.name));
      }, timeout);

      ws.onopen = () => {
        clearTimeout(timer);
        resolve(this.createWebSocketWrapper(ws));
      };

      ws.onerror = (error) => {
        clearTimeout(timer);
        reject(new NetworkError('WebSocket connection failed', 'WS_ERROR', this.name));
      };
    });
  }

  /**
   * 创建 WebSocket 包装器
   */
  private createWebSocketWrapper(ws: WebSocket): IWebSocket {
    return {
      get readyState() {
        return ws.readyState;
      },
      get url() {
        return ws.url;
      },
      send: (data: string | ArrayBuffer) => ws.send(data),
      close: () => ws.close(),
      onMessage: (callback) => {
        ws.onmessage = (event) => {
          callback({
            data: event.data,
            type: 'message',
            timestamp: Date.now()
          });
        };
      },
      onError: (callback) => {
        ws.onerror = () => callback(new Error('WebSocket error'));
      },
      onClose: (callback) => {
        ws.onclose = () => callback();
      },
      onOpen: (callback) => {
        ws.onopen = () => callback();
      }
    };
  }

  /**
   * 提取响应头
   */
  private extractHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * 带进度回调的 Blob 读取
   * @param response - Fetch 响应
   * @param config - 请求配置（包含 expectedSize 和 onProgress）
   */
  private async readBlobWithProgress(
    response: Response,
    config: IRequestConfig
  ): Promise<Blob> {
    const contentLength = response.headers.get('content-length');
    const total = contentLength
      ? parseInt(contentLength, 10)
      : config.expectedSize || 0;
    let loaded = 0;

    const reader = response.body?.getReader();
    if (!reader) {
      throw new NetworkError('Failed to get response reader', 'READ_ERROR', this.name);
    }

    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loaded += value.length;

      if (config.onProgress) {
        const progress = total > 0 ? (loaded / total) * 100 : 0;
        config.onProgress(loaded, total, progress);
      }
    }

    return new Blob(chunks as BlobPart[]);
  }
}
