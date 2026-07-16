/**
 * Node.js 直连网络提供者
 * @description 使用 Node.js 内置 fetch API，无 CORS 限制
 * @ai-example
 * const provider = new DirectProvider();
 * const response = await provider.request({ url: 'https://api.example.com/games' });
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
 * Node.js 直连提供者
 */
export class DirectProvider extends BaseProvider {
  constructor() {
    super({
      name: 'DirectProvider',
      priority: 30,
      supportedEnvironments: [Environment.BACKEND, Environment.DESKTOP]
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

    const fetchOptions: RequestInit = {
      method: config.method ?? 'GET',
      headers,
      body: this.buildBody(config)
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
          data = (await response.blob()) as T;
          break;
        case 'arraybuffer':
          data = (await response.arrayBuffer()) as T;
          break;
        default:
          // 先读 text，再尝试 JSON 解析，避免 body 已消费问题
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
    // 动态导入 ws 库
    const WebSocket = await import('ws');

    return new Promise((resolve, reject) => {
      const ws = new WebSocket.default(url, (options?.protocols as string[] | undefined));

      const timeout = options?.timeout ?? 10000;
      const timer = setTimeout(() => {
        ws.close();
        reject(new TimeoutError(timeout, this.name));
      }, timeout);

      ws.on('open', () => {
        clearTimeout(timer);
        resolve(this.createWebSocketWrapper(ws));
      });

      ws.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(new NetworkError('WebSocket connection failed', 'WS_ERROR', this.name));
      });
    });
  }

  /**
   * 创建 WebSocket 包装器
   */
  private createWebSocketWrapper(ws: any): IWebSocket {
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
        ws.on('message', (data: Buffer) => {
          callback({
            data: data.toString(),
            type: 'message',
            timestamp: Date.now()
          });
        });
      },
      onError: (callback) => {
        ws.on('error', (error: Error) => callback(error));
      },
      onClose: (callback) => {
        ws.on('close', () => callback());
      },
      onOpen: (callback) => {
        ws.on('open', () => callback());
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
}
