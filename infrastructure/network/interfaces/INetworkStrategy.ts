import type { IResponse } from './IResponse';
/**
 * 网络策略接口
 * @description 定义网络策略接口，用于选择最佳网络提供者
 * @ai-example
 * class DefaultNetworkStrategy implements INetworkStrategy {
 *   async selectProvider(env, userCtx) {
 *     const type = await userCtx.getUserType();
 *     const providers = this.getProviderPriority(env, type);
 *     for (const p of providers) {
 *       if (await p.isAvailable()) return p;
 *     }
 *     return null;
 *   }
 * }
 */

import type { Environment } from './Environment';
import type { UserType } from './UserType';
import type { INetworkProvider } from './INetworkProvider';
import type { IUserContext } from './IUserContext';
import type { IRequestConfig } from './IRequestConfig';

/**
 * 网络策略接口
 */
export interface INetworkStrategy {
  /**
   * 根据环境和用户上下文，选择最佳网络提供者
   * @param environment - 运行环境
   * @param userContext - 用户上下文
   * @param requestConfig - 请求配置（可选）
   * @returns 最佳网络提供者（如果存在）
   * @ai-example
   * const provider = await strategy.selectProvider(
   *   Environment.WEB,
   *   userContext,
   *   { url: '/api/games' }
   * );
   */
  selectProvider(
    environment: Environment,
    userContext: IUserContext,
    requestConfig?: IRequestConfig
  ): Promise<INetworkProvider | null>;

  /**
   * 获取提供者优先级列表
   * @param environment - 运行环境
   * @param userType - 用户类型
   * @returns 提供者优先级列表（按优先级从高到低）
   * @ai-example
   * const providers = strategy.getProviderPriority(Environment.WEB, UserType.PAID);
   * console.log(providers.map(p => p.name)); // ['AuthProvider', 'ProxyProvider']
   */
  getProviderPriority(
    environment: Environment,
    userType: UserType
  ): INetworkProvider[];
}

/**
 * 网络策略配置
 */
export interface INetworkStrategyConfig {
  /** 环境策略映射 */
  environmentStrategies?: Partial<Record<Environment, INetworkStrategy>>;

  /** 用户类型策略映射 */
  userTypeStrategies?: Partial<Record<UserType, INetworkStrategy>>;

  /** 默认策略 */
  defaultStrategy?: INetworkStrategy;

  /** 自定义配置 */
  customConfig?: Record<string, unknown>;
}

/**
 * 降级策略接口
 */
export interface IFallbackStrategy {
  /**
   * 执行请求，失败时自动降级
   * @param config - 请求配置
   * @param providers - 提供者列表
   * @returns 响应数据
   */
  execute<T>(
    config: IRequestConfig,
    providers: INetworkProvider[]
  ): Promise<IResponse<T>>;
}
