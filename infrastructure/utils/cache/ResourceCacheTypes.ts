/**
 * 资源缓存配置
 * @description 定义资源缓存的配置接口
 */

/**
 * 资源缓存配置
 */
export interface IResourceCacheConfig {
  /** 缓存键前缀 */
  keyPrefix: string;
  
  /** 默认 TTL（毫秒），可选 */
  defaultTTL?: number | undefined;
  
  /** 是否启用缓存，默认 true */
  enabled?: boolean | undefined;
}
