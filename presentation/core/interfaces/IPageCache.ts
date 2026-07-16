/**
 * 页面缓存接口（用于返回导航时恢复数据）
 * @module presentation/core/interfaces/IPageCache
 */
/** 简单的键值缓存，Web Shell 用 sessionStorage 实现 */
export interface IPageCache {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
