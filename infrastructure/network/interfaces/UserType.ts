/**
 * 用户类型枚举
 * @description 定义用户类型，用于网络策略判断
 * @ai-example
 * const type = UserType.PAID;
 * console.log(type); // 'paid'
 */

/**
 * 用户类型
 */
export enum UserType {
  /** 访客（未登录） */
  GUEST = 'guest',

  /** 免费用户 */
  FREE = 'free',

  /** 付费用户 */
  PAID = 'paid',

  /** 高级付费用户 */
  PREMIUM = 'premium'
}

/**
 * 用户权限枚举
 * @description 定义用户可拥有的权限
 */
export enum UserPermission {
  /** 基础访问 */
  BASIC_ACCESS = 'basic_access',

  /** 高级功能 */
  ADVANCED_FEATURES = 'advanced_features',

  /** 优先级访问 */
  PRIORITY_ACCESS = 'priority_access',

  /** API 限流提升 */
  RATE_LIMIT_BOOST = 'rate_limit_boost',

  /** 数据导出 */
  DATA_EXPORT = 'data_export'
}
