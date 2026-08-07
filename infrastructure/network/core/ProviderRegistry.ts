/**
 * 网络提供者注册表
 * @description 管理所有网络提供者，根据策略选择合适的提供者
 * @ai-example
 * const registry = new ProviderRegistry();
 * registry.register(new DirectProvider());
 * registry.register(new ProxyProvider());
 * const provider = await registry.selectProvider(Environment.WEB);
 */

import type {
  IProviderRegistry,
  INetworkProvider,
  Environment,
  IRequestConfig,
  IResponse
} from '../interfaces';
import { AllProvidersFailedError } from '../interfaces';

/**
 * 提供者注册表实现
 */
export class ProviderRegistry implements IProviderRegistry {
  private providers: Map<string, INetworkProvider> = new Map();

  /**
   * 注册网络提供者
   */
  register(provider: INetworkProvider): void {
    if (this.providers.has(provider.name)) {
      console.warn(
        `Provider "${provider.name}" already registered, will be replaced`
      );
    }
    this.providers.set(provider.name, provider);
  }

  /**
   * 注销网络提供者
   */
  unregister(name: string): void {
    this.providers.delete(name);
  }

  /**
   * 获取所有提供者
   */
  getProviders(): INetworkProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 根据名称获取提供者
   */
  getProvider(name: string): INetworkProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * 根据环境选择最佳提供者
   */
  async selectProvider(
    environment: Environment,
    config?: IRequestConfig
  ): Promise<INetworkProvider | null> {
    const providers = this.getProviders()
      .filter((p) => p.supportedEnvironments.includes(environment))
      .sort((a, b) => b.priority - a.priority);

    for (const provider of providers) {
      try {
        if (await provider.isAvailable()) {
          return provider;
        }
      } catch (error) {
        console.warn(
          `Provider "${provider.name}" availability check failed:`,
          error
        );
      }
    }

    return null;
  }

  /**
   * 按优先级顺序尝试请求（失败自动降级）
   */
  async requestWithFallback<T>(
    config: IRequestConfig,
    environment: Environment
  ): Promise<IResponse<T>> {
    const providers = this.getProviders()
      .filter((p) => p.supportedEnvironments.includes(environment))
      .sort((a, b) => b.priority - a.priority);

    if (providers.length === 0) {
      throw new AllProvidersFailedError([
        new Error('No providers available for the specified environment')
      ]);
    }

    const errors: Error[] = [];

    for (const provider of providers) {
      try {
        if (!(await provider.isAvailable())) {
          continue;
        }

        const response = await provider.request<T>(config);
        return response;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        console.warn(
          `Provider "${provider.name}" request failed:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    throw new AllProvidersFailedError(errors);
  }

  /**
   * 清空所有提供者
   */
  clear(): void {
    this.providers.clear();
  }
}
