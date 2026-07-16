/**
 * @fileoverview Game 策略接口和默认实现
 */

import type { IGameProvider } from './providers/base/IProvider';
import type { IUserContext, Environment } from '../../infrastructure/network/interfaces';
import type { PlatformCapabilities } from '../../infrastructure/platform/interfaces';
import { PlatformDetector } from '../../infrastructure/platform';

/**
 * Game 策略配置
 */
export interface IGameStrategyConfig {
  /** 用户上下文 */
  userContext?: IUserContext | undefined;
  /** Sniffer 提供者 */
  snifferProvider?: import('../../infrastructure/network/interfaces').ISnifferProvider | undefined;
}

/**
 * Game 策略接口
 * @description 根据平台能力选择最佳游戏提供者
 */
export interface IGameStrategy {
  /**
   * 选择最佳游戏提供者
   * @param url - 游戏 URL
   * @param providers - 可用提供者列表
   * @param userContext - 用户上下文
   */
  selectProvider(
    url: string,
    providers: Map<string, IGameProvider>,
    userContext?: IUserContext
  ): Promise<IGameProvider | null>;
}

/**
 * 默认 Game 策略
 * @description 根据平台能力和付费状态选择最佳提供者
 */
export class DefaultGameStrategy implements IGameStrategy {
  private snifferProvider?: import('../../infrastructure/network/interfaces').ISnifferProvider | undefined;

  constructor(config?: IGameStrategyConfig) {
    this.snifferProvider = config?.snifferProvider;
  }

  /**
   * 选择最佳游戏提供者
   */
  async selectProvider(
    url: string,
    providers: Map<string, IGameProvider>,
    userContext?: IUserContext
  ): Promise<IGameProvider | null> {
    const platform = PlatformDetector.detect();
    const capabilities = PlatformDetector.getCapabilities(platform);
    const userType = userContext ? await userContext.getUserType() : 'free';

    // 查找支持该 URL 的提供者
    for (const provider of providers.values()) {
      if (provider.canHandle(url)) {
        // 检查提供者是否可用（考虑平台能力）
        if (await this.checkProviderAvailability(provider, capabilities, userType)) {
          return provider;
        }
      }
    }

    return null;
  }

  /**
   * 检查提供者可用性
   */
  private async checkProviderAvailability(
    provider: IGameProvider,
    capabilities: PlatformCapabilities,
    userType: string
  ): Promise<boolean> {
    const providerName = provider.name;

    // 付费用户可能有特殊权限
    if (userType === 'paid' || userType === 'premium') {
      // 付费用户可以访问所有提供者（假设服务器端代理）
      return true;
    }

    // Sniffer Providers（需要 Sniffer 支持）
    const snifferProviders = [
      'txwq', 'yike', 'weiqi1919', 'izis', 'xinboduiyi', 'yike-shaoer'
    ];

    if (snifferProviders.includes(providerName)) {
      // 检查 Sniffer 是否可用
      return this.snifferProvider?.isAvailable() ?? false;
    }

    // izis-archive 不需要 Sniffer，直接 HTTP 请求
    if (providerName === 'izis-archive') {
      return true;
    }

    // REST API Providers（无需特殊能力）
    return true;
  }
}