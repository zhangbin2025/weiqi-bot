/**
 * AuthenticatedProvider 配置类型
 * @description 定义付费通道提供者的配置接口
 */

import type { Environment } from '../../interfaces';

/**
 * AuthenticatedProvider 配置
 */
export interface IAuthenticatedProviderConfig {
  /** API 服务器地址 */
  apiUrl: string;

  /** 认证 Token（可选，从 IUserContext 获取） */
  authToken?: string;

  /** 超时时间（毫秒） */
  timeout?: number;

  /** 支持的环境 */
  supportedEnvironments?: Environment[];
}
