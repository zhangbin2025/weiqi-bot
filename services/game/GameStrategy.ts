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

/** foxwq 直播 URL 模式 */
const FOXWQ_LIVE_PATTERN = /foxwq\.com.*(svrtype=20010|roomid=|golive)/i;

/**
 * 需要 Sniffer 支持的 Provider 名称列表
 * 纯 Web 环境下 Sniffer 不可用时，这些 provider 会被跳过，让 remote 兜底
 */
const SNIFFER_DEPENDENT_PROVIDERS = [
  'txwq',
  'yike',
  'yike-online',
  'weiqi1919',
  'xinboduiyi',
  'yike-shaoer',
];

/**
 * 默认 Game 策略
 * @description 根据平台能力和付费状态选择最佳提供者
 *
 * Provider 遍历顺序由 GameProviderRegistry 注册顺序决定：
 * - REST API 型 provider 优先（本地可用）
 * - Sniffer 依赖型 provider 在纯 Web 环境不可用，被跳过
 * - foxwq 直播 URL 在 Sniffer 不可用时跳过（让 remote 兜底）
 * - RemoteGameProvider 注册在最后（兜底），匹配 Sniffer 依赖型 URL
 *
 * RemoteGameProvider 在 fetch 时自行等待隧道连接（ensureConnected），
 * Strategy 不需要感知隧道状态。
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
        if (await this.checkProviderAvailability(provider, url, capabilities, userType)) {
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
    url: string,
    capabilities: PlatformCapabilities,
    userType: string
  ): Promise<boolean> {
    const providerName = provider.name;

    // Remote Provider：始终可用（fetch 时自行等待隧道连接）
    if (providerName === 'remote') {
      return true;
    }

    // 付费用户可能有特殊权限
    if (userType === 'paid' || userType === 'premium') {
      return true;
    }

    // Sniffer 依赖型 Provider：检查 Sniffer 是否可用
    if (SNIFFER_DEPENDENT_PROVIDERS.includes(providerName)) {
      return this.snifferProvider?.isAvailable() ?? false;
    }

    // foxwq 直播 URL 需要 Sniffer，纯 Web 环境下不可用
    // 跳过 foxwq，让 remote 兜底
    if (providerName === 'foxwq' && FOXWQ_LIVE_PATTERN.test(url)) {
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
