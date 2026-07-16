/**
 * 认证管理器接口
 * @module infrastructure/auth/IAuthManager
 */

import type { AuthStatus, IUserInfo } from './types';

/**
 * 认证管理器接口
 * @ai-example
 * const auth: IAuthManager = {
 *   getToken: () => 'token',
 *   saveToken: (t) => { },
 *   clearToken: () => { },
 *   hasToken: () => true,
 *   validateToken: async () => true,
 *   getUserInfo: async () => null,
 *   getApiBase: async () => 'https://api.example.com',
 *   status: 'authenticated',
 *   onStatusChange: (cb) => { }
 * };
 */
export interface IAuthManager {
  /** 获取 Token */
  getToken(): string | null;
  /** 保存 Token */
  saveToken(token: string): void;
  /** 清除 Token */
  clearToken(): void;
  /** 是否有 Token */
  hasToken(): boolean;
  /** 验证 Token 有效性 */
  validateToken(token?: string): Promise<boolean>;
  /** 获取用户信息 */
  getUserInfo(): Promise<IUserInfo | null>;
  /** 获取 API 基础 URL（动态获取） */
  getApiBase(): Promise<string>;
  /** 认证状态 */
  readonly status: AuthStatus;
  /** 状态变更回调 */
  onStatusChange(callback: (status: AuthStatus) => void): void;
}
