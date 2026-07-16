/**
 * 网络配置默认值应用器
 * @description 将 Network 配置应用到请求配置
 */

import type { IRequestConfig } from '../interfaces';
import type { INetworkConfig } from '../../config/schemas/NetworkConfigSchema';

/**
 * 应用配置默认值到请求配置
 * @param config 原始请求配置
 * @param networkConfig 网络模块配置
 * @returns 应用默认值后的请求配置
 */
export function applyNetworkConfigDefaults(
  config: IRequestConfig,
  networkConfig: INetworkConfig
): IRequestConfig {
  return {
    ...config,
    timeout: config.timeout ?? networkConfig.defaultTimeout,
    retryCount: config.retryCount ?? networkConfig.retryCount
  };
}
