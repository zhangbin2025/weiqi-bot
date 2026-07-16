/**
 * Activity 模块配置模式
 * @description 定义 Activity 模块的配置结构和默认值
 */

/**
 * Activity 模块配置接口
 */
export interface IActivityConfig {
  /** 默认存储路径 */
  storagePath: string;
  /** 最大历史条数 */
  maxHistoryEntries: number;
  /** 过期时间（毫秒），0 表示不过期 */
  expireAfterMs: number;
}

/**
 * Activity 配置默认值
 */
export const ActivityConfigSchema: IActivityConfig = {
  storagePath: 'activity',
  maxHistoryEntries: 1000,
  expireAfterMs: 0,
};
