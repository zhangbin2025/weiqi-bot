/**
 * 默认网络策略
 * @description 根据环境、用户类型和平台能力选择最佳网络提供者
 * @ai-example
 * const strategy = new DefaultNetworkStrategy();
 * const provider = await strategy.selectProvider(Environment.WEB, userContext);
 */

import type {
  INetworkStrategy,
  INetworkProvider,
  Environment,
  UserType,
  IUserContext,
  IRequestConfig
} from '../interfaces';
import { PlatformDetector } from '../../platform';
import type { PlatformCapabilities } from '../../platform/interfaces';
import { createUnsupportedProvider } from '../adapters/common/UnsupportedProvider';
import { REST_API_PLATFORMS } from './PlatformConstants';

/**
 * 默认网络策略实现
 *
 * 优先级规则：
 * 1. 付费用户：优先付费通道（AuthenticatedProvider）
 * 2. 同源请求：直接请求（DirectProvider）
 * 3. REST API：直接请求
 * 4. 兜底：ProxyProvider
 * 5. 不支持：返回 UnsupportedProvider
 */
export class DefaultNetworkStrategy implements INetworkStrategy {
  private providers: Map<string, INetworkProvider> = new Map();
  private providerList: INetworkProvider[] = [];

  /** 注册提供者列表 */
  setProviders(providers: INetworkProvider[]): void {
    this.providerList = providers;
    this.providers.clear();
    providers.forEach(p => this.providers.set(p.name, p));
  }

  /** 根据名称获取提供者 */
  getProvider(name: string): INetworkProvider | undefined {
    return this.providers.get(name);
  }

  /** 根据环境和用户上下文，选择最佳网络提供者 */
  async selectProvider(
    environment: Environment,
    userContext: IUserContext,
    requestConfig?: IRequestConfig
  ): Promise<INetworkProvider | null> {
    const userType = await userContext.getUserType();
    const platform = PlatformDetector.detect();
    const capabilities = PlatformDetector.getCapabilities(platform);

    // 1. 付费用户：优先付费通道
    if (userType === 'paid' || userType === 'premium') {
      const authProvider = this.getProvider('AuthenticatedProvider');
      if (authProvider && await this.checkAvailable(authProvider)) {
        return authProvider;
      }
    }

    // 2. 同源请求：直接请求（DirectProvider）
    if (this.isSameOrigin(requestConfig?.url) && environment === 'web') {
      const provider = this.getProvider('DirectProvider');
      if (provider && await this.checkAvailable(provider)) return provider;
    }

    // 3. REST API 平台：直接请求（仅非 Web 环境）
    if (this.isRestApiPlatform(requestConfig?.url) && environment !== 'web') {
      const provider = this.getProvider('DirectProvider');
      if (provider && await this.checkAvailable(provider)) return provider;
    }

    // 4. 标记绕过代理：强制 DirectProvider（如 IP 定位需要真实客户端 IP）
    if (requestConfig?.bypassProxy) {
      const direct = this.getProvider('DirectProvider');
      if (direct && await this.checkAvailable(direct)) return direct;
    }

    // 5. 兜底：ProxyProvider（Web 环境跨域请求）
    const proxy = this.getProvider('ProxyProvider');
    if (proxy && await this.checkAvailable(proxy)) return proxy;

    // 6. 不支持：返回友好提示
    return createUnsupportedProvider(environment, capabilities, requestConfig?.url);
  }

  /** 获取提供者优先级列表 */
  getProviderPriority(environment: Environment, userType: UserType): INetworkProvider[] {
    const filtered = this.providerList.filter(p =>
      p.supportedEnvironments.includes(environment)
    );
    return this.sortByUserType(filtered, userType);
  }

  /** 检查提供者是否可用 */
  private async checkAvailable(provider: INetworkProvider): Promise<boolean> {
    try {
      return await provider.isAvailable();
    } catch (error) {
      console.warn(`Provider "${provider.name}" availability check failed:`, error);
      return false;
    }
  }

  /** 根据用户类型排序提供者 */
  private sortByUserType(providers: INetworkProvider[], userType: UserType): INetworkProvider[] {
    const sorted = [...providers];
    sorted.sort((a, b) => {
      if (userType === 'paid' || userType === 'premium') {
        if (a.name === 'AuthenticatedProvider' && b.name !== 'AuthenticatedProvider') return -1;
        if (a.name !== 'AuthenticatedProvider' && b.name === 'AuthenticatedProvider') return 1;
      }
      return b.priority - a.priority;
    });
    return sorted;
  }

  private isRestApiPlatform(url?: string): boolean {
    if (!url) return false;
    return REST_API_PLATFORMS.some(p => url.includes(p));
  }

  /** 检查是否同源请求 */
  private isSameOrigin(url?: string): boolean {
    if (!url) return false;
    // 绝对路径（以 / 开头）或相对路径都是同源
    if (url.startsWith('/')) return true;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return true;
    // 检查完整 URL 是否同源
    if (typeof window !== 'undefined' && window.location) {
      try {
        const requestUrl = new URL(url, window.location.href);
        return requestUrl.origin === window.location.origin;
      } catch {
        return false;
      }
    }
    return false;
  }
}
