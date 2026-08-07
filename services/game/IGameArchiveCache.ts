/**
 * @fileoverview 棋谱缓存服务接口
 */

/**
 * 棋谱缓存服务接口
 *
 * 用于缓存归档ID，不缓存实际SGF内容。
 * 缓存的内容归档由 GameHistoryStorage 管理。
 */
export interface IGameArchiveCache {
  /**
   * 获取缓存的归档ID
   * @param cacheKey - 缓存键
   * @returns 归档ID，未缓存返回 null
   */
  get(cacheKey: string): Promise<string | null>;

  /**
   * 设置缓存（归档ID）
   * @param cacheKey - 缓存键
   * @param archiveId - 归档ID
   */
  set(cacheKey: string, archiveId: string): Promise<void>;

  /**
   * 判断是否缓存命中
   * @param cacheKey - 缓存键
   * @returns 是否存在缓存
   */
  has(cacheKey: string): Promise<boolean>;

  /**
   * 清除缓存
   */
  clear(): Promise<void>;
}