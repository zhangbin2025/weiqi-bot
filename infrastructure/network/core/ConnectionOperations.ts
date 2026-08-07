/**
 * 连接操作助手
 * @description 封装网络管理器的连接相关操作逻辑
 */

import { ProviderRegistry } from './ProviderRegistry';
import { DefaultNetworkStrategy } from './DefaultNetworkStrategy';
import type {
  Environment,
  IUserContext,
  IWebSocket,
  IWebSocketOptions,
  IWebRTC,
  IWebRTCConfig,
  INetworkProvider
} from '../interfaces';

/**
 * 连接操作助手类
 * @description 处理 WebSocket 和 WebRTC 连接的建立和管理
 */
export class ConnectionOperations {
  constructor(
    private registry: ProviderRegistry,
    private strategy: DefaultNetworkStrategy,
    private getCurrentEnv: () => Environment,
    private getUserContext: () => IUserContext | undefined
  ) {}

  /**
   * 建立 WebSocket 连接
   */
  async connect(url: string, options?: IWebSocketOptions): Promise<IWebSocket> {
    const provider = await this.selectProvider();

    if (!provider) {
      throw new Error('No available provider for WebSocket connection');
    }

    return provider.connect(url, options);
  }

  /**
   * 创建 WebRTC P2P 连接
   */
  async createP2PConnection(config: IWebRTCConfig): Promise<IWebRTC> {
    const provider = await this.selectProvider();

    if (!provider || !provider.createP2PConnection) {
      throw new Error('No available provider for WebRTC connection');
    }

    return provider.createP2PConnection(config);
  }

  /**
   * 选择提供者
   */
  private async selectProvider(): Promise<INetworkProvider | null> {
    const userContext = this.getUserContext();
    const currentEnv = this.getCurrentEnv();

    if (!userContext) {
      // 没有用户上下文时，直接从注册表选择
      return this.registry.selectProvider(currentEnv);
    }

    return this.strategy.selectProvider(currentEnv, userContext);
  }
}
