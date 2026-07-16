/**
 * @fileoverview EventService 接口定义
 * @description 云比赛网查询服务接口（赛事服务）
 */

import type {
  EventQueryOptions,
  EventListResult,
  GroupListResult,
  PlayerListResult,
  AgainstPlanResult,
  AllRoundsResult,
  ProgressCallback,
} from './types';

/**
 * 云比赛网查询服务接口（赛事服务）
 *
 * 提供比赛、分组、对阵表查询功能。
 *
 * @ai-example
 * const service: IEventService = new EventService(network, cache, config);
 * const events = await service.getEvents({ area: '广东省', month: 1 });
 * console.log(events.events[0].title);
 */
export interface IEventService {
  /**
   * 获取比赛列表
   * @param options - 查询选项
   * @returns 比赛列表结果
   * @ai-example
   * const result = await service.getEvents({ area: '广东省', month: 3 });
   * console.log(`找到 ${result.total} 个比赛`);
   */
  getEvents(options?: EventQueryOptions): Promise<EventListResult>;

  /**
   * 获取比赛分组
   * @param eventId - 比赛ID
   * @returns 分组列表结果
   * @ai-example
   * const groups = await service.getGroups(12345);
   * console.log(groups.groups[0].name);
   */
  getGroups(eventId: number): Promise<GroupListResult>;

  /**
   * 获取分组选手
   * @param eventId - 比赛ID
   * @param groupId - 分组ID
   * @returns 选手列表结果
   * @ai-example
   * const players = await service.getGroupPlayers(12345, 100);
   */
  getGroupPlayers(eventId: number, groupId: number): Promise<PlayerListResult>;

  /**
   * 搜索比赛
   * @param keyword - 搜索关键词
   * @returns 比赛列表结果
   */
  search(keyword: string): Promise<EventListResult>;

  /**
   * 获取轮次对阵
   * @param groupId - 分组ID
   * @param bout - 轮次
   * @returns 对阵结果
   * @ai-example
   * const plan = await service.getAgainstPlan(100, 1);
   * console.log(plan.rows[0].p1Name);
   */
  getAgainstPlan(groupId: number, bout: number): Promise<AgainstPlanResult>;

  /**
   * 获取所有轮次对阵
   * @param groupId - 分组ID
   * @param onProgress - 进度回调（可选）
   * @param forceRefresh - 强制刷新（清除缓存重新下载）
   * @returns 所有轮次对阵结果
   * @ai-example
   * const result = await service.getAllRounds(100, (msg, pct) => {
   *   console.log(`${msg} (${pct}%)`);
   * });
   */
  getAllRounds(
    groupId: number,
    onProgress?: ProgressCallback,
    forceRefresh?: boolean
  ): Promise<AllRoundsResult>;

  /**
   * 从缓存获取所有轮次对阵
   * @param groupId - 分组ID
   * @returns 缓存结果，不存在返回 null
   * @ai-example
   * const cached = await service.getAllRoundsFromCache(100);
   */
  getAllRoundsFromCache(groupId: number): Promise<AllRoundsResult | null>;

  /**
   * 清除分组对阵缓存
   * @param groupId - 分组ID
   * @ai-example
   * await service.clearGroupCache(100);
   */
  clearGroupCache(groupId: number): Promise<void>;
}
