/**
 * 认证模块类型定义
 * @module infrastructure/auth/types
 */

/**
 * 认证状态
 * - 'authenticated' - 已认证
 * - 'unauthenticated' - 未认证
 * - 'expired' - 已过期
 */
export type AuthStatus = 'authenticated' | 'unauthenticated' | 'expired';

/**
 * 用户信息
 */
export interface IUserInfo {
  /** 用户 ID */
  id: string;
  /** 用户名 */
  name: string;
  /** 邮箱（可选） */
  email?: string;
  /** 套餐类型 */
  plan: 'free' | 'paid';
  /** 过期时间戳（毫秒） */
  expiresAt?: number;
}

/**
 * 认证配置
 */
export interface IAuthConfig {
  /** API 基础 URL（动态获取） */
  apiUrl?: string;
  /** 域名配置 URL */
  domainConfigUrl?: string;
  /** Token 存储 key */
  tokenKey?: string;
  /** Token 过期时间（毫秒） */
  tokenExpiry?: number;
}
