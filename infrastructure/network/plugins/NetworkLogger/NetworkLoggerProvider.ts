/**
 * 网络日志提供者（包装器）
 * @description 包装其他提供者，记录所有网络请求
 */

import type {
  INetworkProvider,
  IRequestConfig,
  IResponse,
  IWebSocket,
  IWebSocketOptions,
  IWebRTC,
  IWebRTCConfig,
  Environment
} from '../../interfaces';
import type { INetworkLogEntry, INetworkLoggerConfig } from './NetworkLoggerTypes';
import { NetworkLogStorage } from './NetworkLogStorage';

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 网络日志提供者（包装器）
 */
export class NetworkLoggerProvider implements INetworkProvider {
  readonly name: string;
  readonly priority: number;
  readonly supportedEnvironments: Environment[];

  private wrappedProvider: INetworkProvider;
  private originalName: string;
  private storage: NetworkLogStorage;
  private config: INetworkLoggerConfig;

  constructor(
    provider: INetworkProvider,
    storage: NetworkLogStorage,
    config: INetworkLoggerConfig = {}
  ) {
    this.wrappedProvider = provider;
    this.storage = storage;
    this.config = {
      enabled: true,
      maxEntries: 1000,
      logHeaders: true,
      logRequestBody: true,
      logResponseBody: false,
      ...config
    };

    this.name = provider.name;
    this.originalName = `Logger[${provider.name}]`;
    this.priority = provider.priority;
    this.supportedEnvironments = provider.supportedEnvironments;
  }

  /**
   * 发起 HTTP 请求（记录日志）
   */
  async request<T>(config: IRequestConfig): Promise<IResponse<T>> {
    if (!this.config.enabled) {
      return this.wrappedProvider.request<T>(config);
    }

    const startTime = Date.now();
    const entry: Partial<INetworkLogEntry> = {
      id: generateId(),
      timestamp: startTime,
      request: {
        url: config.url,
        method: config.method ?? 'GET',
        ...(this.config.logHeaders && config.headers ? { headers: config.headers } : {}),
        ...(config.params ? { params: config.params } : {}),
        ...(this.config.logRequestBody && config.data !== undefined ? { data: config.data } : {})
      },
      provider: this.originalName
    };

    try {
      const response = await this.wrappedProvider.request<T>(config);

      // 记录成功响应
      entry.success = true;
      entry.response = {
        status: response.status,
        statusText: response.statusText,
        duration: response.duration,
        size: this.calculateSize(response.data)
      };

      this.storage.add(entry as INetworkLogEntry);

      // 调用自定义处理器
      if (this.config.customHandler) {
        this.config.customHandler(entry as INetworkLogEntry);
      }

      return response;
    } catch (error) {
      // 记录错误
      entry.success = false;
      entry.error = {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'REQUEST_ERROR',
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
      };

      this.storage.add(entry as INetworkLogEntry);

      // 调用自定义处理器
      if (this.config.customHandler) {
        this.config.customHandler(entry as INetworkLogEntry);
      }

      throw error;
    }
  }

  /**
   * 建立 WebSocket 连接
   */
  async connect(url: string, options?: IWebSocketOptions): Promise<IWebSocket> {
    return this.wrappedProvider.connect(url, options);
  }

  /**
   * 创建 P2P 连接
   */
  async createP2PConnection?(config: IWebRTCConfig): Promise<IWebRTC> {
    if (this.wrappedProvider.createP2PConnection) {
      return this.wrappedProvider.createP2PConnection(config);
    }
    throw new Error('P2P connection not supported');
  }

  /**
   * 检查提供者是否可用
   */
  async isAvailable(): Promise<boolean> {
    return this.wrappedProvider.isAvailable();
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    return this.wrappedProvider.healthCheck();
  }

  /**
   * 计算数据大小
   */
  private calculateSize(data: unknown): number {
    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }

  /**
   * 获取底层提供者
   */
  getWrappedProvider(): INetworkProvider {
    return this.wrappedProvider;
  }
}
