/**
 * 会话数据接口
 * @description 会话存储的数据结构，包含元数据和业务数据
 */
export interface ISessionData<T = unknown> {
  /** 会话 ID */
  id: string;

  /** 会话类型（用于分类管理） */
  type: string;

  /** 业务数据 */
  data: T;

  /** 创建时间戳 */
  createdAt: number;

  /** 最后访问时间戳 */
  lastAccessedAt: number;

  /** 过期时间戳（毫秒） */
  expiresAt: number;

  /** 扩展元数据（可选） */
  metadata?: Record<string, unknown>;
}
