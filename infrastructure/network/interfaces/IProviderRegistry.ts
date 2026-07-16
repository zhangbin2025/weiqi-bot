/**
 * 网络提供者注册表接口
 * @description 管理所有网络提供者，根据策略选择合适的提供者
 * @ai-example
 * const registry = new ProviderRegistry();
 * registry.register(new DirectProvider());
 * registry.register(new ProxyProvider());
 * const provider = await registry.selectProvider(Environment.WEB);
 */

import type { Environment } from './Environment';
import type { INetworkProvider } from './INetworkProvider';
import type { IRequestConfig } from './IRequestConfig';
import type { IResponse } from './IResponse';

/**
 * 提供者注册表接口
 */
export interface IProviderRegistry {
  /**
   * 注册网络提供者
   * @param provider - 网络提供者实例
   * @ai-example
   * registry.register(new DirectProvider());
   */
  register(provider: INetworkProvider): void;

  /**
   * 注销网络提供者
   * @param name - 提供者名称
   */
  unregister(name: string): void;

  /**
   * 获取所有提供者
   * @returns 提供者列表
   */
  getProviders(): INetworkProvider[];

  /**
   * 根据名称获取提供者
   * @param name - 提供者名称
   * @returns 提供者实例（如果存在）
   */
  getProvider(name: string): INetworkProvider | undefined;

  /**
   * 根据环境选择最佳提供者
   * @param environment - 运行环境
   * @param config - 请求配置（可选）
   * @returns 最佳提供者（如果存在）
   * @ai-example
   * const provider = await registry.selectProvider(Environment.WEB);
   */
  selectProvider(
    environment: Environment,
    config?: IRequestConfig
  ): Promise<INetworkProvider | null>;

  /**
   * 按优先级顺序尝试请求（失败自动降级）
   * @param config - 请求配置
   * @param environment - 运行环境
   * @returns 响应数据
   * @ai-example
   * const response = await registry.requestWithFallback(
   *   { url: '/api/games' },
   *   Environment.WEB
   * );
   */
  requestWithFallback<T>(
    config: IRequestConfig,
    environment: Environment
  ): Promise<IResponse<T>>;

  /**
   * 清空所有提供者
   */
  clear(): void;
}

/**
 * 提供者过滤器
 */
export interface IProviderFilter {
  /**
   * 过滤提供者
   * @param providers - 提供者列表
   * @param environment - 运行环境
   * @param config - 请求配置
   * @returns 过滤后的提供者列表
   */
  filter(
    providers: INetworkProvider[],
    environment: Environment,
    config?: IRequestConfig
  ): INetworkProvider[];
}
