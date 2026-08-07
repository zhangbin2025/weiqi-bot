/**
 * 用户上下文接口
 * @description 用于判断用户类型和权限，供网络策略使用
 * @ai-example
 * const userContext: IUserContext = {
 *   getUserType: async () => UserType.PAID,
 *   hasPaidToken: async () => true,
 *   getAuthToken: async () => 'token123'
 * };
 */

import type { UserType, UserPermission } from './UserType';

/**
 * 用户上下文接口
 */
export interface IUserContext {
  /**
   * 获取当前用户类型
   * @returns 用户类型
   * @ai-example
   * const type = await userContext.getUserType();
   * console.log(type); // UserType.PAID
   */
  getUserType(): Promise<UserType>;

  /**
   * 检查是否有付费 token
   * @returns 是否有付费 token
   */
  hasPaidToken(): Promise<boolean>;

  /**
   * 获取认证 token（如果有）
   * @returns Token 字符串或 null
   */
  getAuthToken(): Promise<string | null>;

  /**
   * 检查是否有特定权限
   * @param permission - 权限名称
   * @returns 是否有权限
   * @ai-example
   * const hasAccess = await userContext.hasPermission(UserPermission.PRIORITY_ACCESS);
   */
  hasPermission(permission: UserPermission | string): Promise<boolean>;

  /**
   * 刷新 token（如果支持）
   * @returns 新 token 或 null
   */
  refreshToken?(): Promise<string | null>;

  /**
   * 获取用户 ID（如果有）
   * @returns 用户 ID 或 null
   */
  getUserId?(): Promise<string | null>;

  /**
   * 获取用户元数据
   * @returns 用户元数据
   */
  getMetadata?(): Promise<Record<string, unknown>>;
}

/**
 * 用户上下文提供者接口
 * @description 用于提供用户上下文的接口
 */
export interface IUserContextProvider {
  /**
   * 获取当前用户上下文
   * @returns 用户上下文实例
   */
  getContext(): IUserContext;

  /**
   * 更新用户上下文
   * @param context - 新的用户上下文
   */
  updateContext(context: Partial<IUserContext>): void;

  /**
   * 清除用户上下文
   */
  clearContext(): void;
}
