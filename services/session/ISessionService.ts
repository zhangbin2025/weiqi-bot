import type { ISessionData } from './ISessionData';

/**
 * 会话服务接口
 * @description 管理会话数据的生命周期，支持自动过期
 *
 * ## 适用场景
 * - 对弈会话状态管理
 * - 复盘会话临时数据
 * - 用户认证会话
 * - 分析会话中间结果
 *
 * ## 使用示例
 * ```typescript
 * const sessionService = new SessionService(cacheStorage);
 * await sessionService.initialize();
 *
 * // 创建会话（30分钟后过期）
 * const sessionId = await sessionService.create('play', { board: [], moves: [] });
 *
 * // 读取会话
 * const session = await sessionService.get<PlayData>(sessionId);
 *
 * // 更新会话（刷新 TTL）
 * await sessionService.update(sessionId, { board: newBoard });
 * ```
 */
export interface ISessionService {
  /**
   * 创建会话
   * @param type - 会话类型
   * @param data - 会话数据
   * @param ttl - 存活时间（毫秒），可选，默认 30 分钟
   * @returns 会话 ID
   * @ai-example
   * const id = await sessionService.create('play', { board: [] }, 3600000); // 1小时
   */
  create<T>(type: string, data: T, ttl?: number): Promise<string>;

  /**
   * 获取会话
   * @param id - 会话 ID
   * @returns 会话数据，不存在或已过期返回 null
   * @ai-example
   * const session = await sessionService.get<PlayData>('sess:xxx');
   */
  get<T>(id: string): Promise<ISessionData<T> | null>;

  /**
   * 更新会话数据
   * @param id - 会话 ID
   * @param data - 新数据
   * @param refreshTtl - 是否刷新 TTL（延长过期时间），默认 true
   * @ai-example
   * await sessionService.update('sess:xxx', { board: newBoard });
   */
  update<T>(id: string, data: T, refreshTtl?: boolean): Promise<void>;

  /**
   * 删除会话
   * @param id - 会话 ID
   * @ai-example
   * await sessionService.delete('sess:xxx');
   */
  delete(id: string): Promise<void>;

  /**
   * 检查会话是否存在
   * @param id - 会话 ID
   * @returns 是否存在（已过期返回 false）
   * @ai-example
   * const exists = await sessionService.has('sess:xxx');
   */
  has(id: string): Promise<boolean>;

  /**
   * 刷新会话 TTL
   * @param id - 会话 ID
   * @param ttl - 新的存活时间（毫秒），可选，默认延长 30 分钟
   * @ai-example
   * await sessionService.refresh('sess:xxx', 3600000); // 延长 1 小时
   */
  refresh(id: string, ttl?: number): Promise<void>;

  /**
   * 获取会话剩余时间
   * @param id - 会话 ID
   * @returns 剩余毫秒数，不存在返回 0
   * @ai-example
   * const remaining = await sessionService.getRemainingTime('sess:xxx');
   */
  getRemainingTime(id: string): Promise<number>;

  /**
   * 按类型查询会话
   * @param type - 会话类型
   * @returns 会话列表
   * @ai-example
   * const sessions = await sessionService.getByType('play');
   */
  getByType<T>(type: string): Promise<ISessionData<T>[]>;

  /**
   * 清理过期会话
   * @returns 清理的会话数量
   * @ai-example
   * const cleaned = await sessionService.cleanup();
   */
  cleanup(): Promise<number>;

  /**
   * 初始化服务
   */
  initialize(): Promise<void>;
}
