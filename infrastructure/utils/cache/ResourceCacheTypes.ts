/**
 * 资源缓存配置
 * @description 定义资源缓存的配置接口
 */

/**
 * 资源缓存配置
 */
export interface IResourceCacheConfig<T = unknown> {
  /** 缓存键前缀 */
  keyPrefix: string;
  
  /** 默认 TTL（毫秒），可选 */
  defaultTTL?: number | undefined;
  
  /**
   * 是否启用缓存。
   * 注意：这是底层工具，默认 true 仅为兼容直接调用方；上层服务是否缓存
   * 由各自的 enable*Cache 配置决定（会变的查询结果默认不进入本工具）。
   */
  enabled?: boolean | undefined;

  /**
   * 缓存命中时的业务校验，返回 false 视为无效缓存（删除并重新下载）。
   * 用于自愈历史遗留的「网络失败被当成查不到」的坏结果。
   */
  validate?: ((data: T) => boolean) | undefined;
}
