/**
 * 网络统计提供者（包装器）
 * @description 包装其他提供者，统计所有网络请求
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
import { NetworkStatsStorage } from './NetworkStatsStorage';
import type { INetworkStatsConfig } from './NetworkStatsTypes';

/**
 * 网络统计提供者（包装器）
 */
export class NetworkStatsProvider implements INetworkProvider {
  readonly name: string;
  readonly priority: number;
  readonly supportedEnvironments: Environment[];

  private wrappedProvider: INetworkProvider;
  private storage: NetworkStatsStorage;
  private config: INetworkStatsConfig;

  constructor(
    provider: INetworkProvider,
    storage: NetworkStatsStorage,
    config: INetworkStatsConfig = {}
  ) {
    this.wrappedProvider = provider;
    this.storage = storage;
    this.config = {
      enabled: true,
      groupByUrl: true,
      groupByMethod: true,
      groupByProvider: true,
      ...config
    };

    this.name = `Stats[${provider.name}]`;
    this.priority = provider.priority;
    this.supportedEnvironments = provider.supportedEnvironments;
  }

  /**
   * 发起 HTTP 请求（记录统计）
   */
  async request<T>(config: IRequestConfig): Promise<IResponse<T>> {
    if (!this.config.enabled) {
      return this.wrappedProvider.request<T>(config);
    }

    const startTime = Date.now();

    try {
      const response = await this.wrappedProvider.request<T>(config);
      const responseTime = Date.now() - startTime;
      const bytes = this.calculateSize(response.data);

      // 记录成功的请求
      this.storage.recordRequest(
        config.url,
        config.method ?? 'GET',
        this.wrappedProvider.name,
        true,
        responseTime,
        bytes
      );

      // 调用自定义处理器
      if (this.config.customHandler) {
        this.config.customHandler(this.storage.getGlobalStats());
      }

      return response;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // 记录失败的请求
      this.storage.recordRequest(
        config.url,
        config.method ?? 'GET',
        this.wrappedProvider.name,
        false,
        responseTime,
        0
      );

      // 调用自定义处理器
      if (this.config.customHandler) {
        this.config.customHandler(this.storage.getGlobalStats());
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
