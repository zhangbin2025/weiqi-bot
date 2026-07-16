/**
 * 云比赛应用编排器
 * @description Application 层编排器，组合 EventService、RankingCalculator、FavoriteService 完成云比赛业务流程
 */
import type { IEventService, EventListResult, Group, AgainstPlanResult, AllRoundsResult, ProgressCallback } from '../../services/event';
import type { IRankingCalculator, RankingResult, RankingMode, MatchData } from '../../domain/ranking';
import type { IFavoriteService } from '../../services/favorite';
import type { EventQueryOptions } from '../../services/event/types';
/** 比赛详情 */
export interface EventDetail {
  eventId: number;
  groups: Group[];
}
/** 访问历史查询选项 */
export interface EventHistoryOptions {
  keyword?: string;
  limit?: number;
  offset?: number;
}
/** 访问历史条目 */
export interface EventHistoryEntry {
  id: string;
  eventId: number;
  title: string;
  visitedAt: number;
}
/** 活动统计 */
export interface EventStats {
  total: number;
  today: number;
}
/**
 * 云比赛应用编排器
 * @description 组合 EventService、RankingCalculator、FavoriteService 完成云比赛业务流程
 */
export class EventQuerier {
  constructor(
    private readonly eventService?: IEventService,
    private readonly rankingCalculator?: IRankingCalculator,
    private readonly favoriteService?: IFavoriteService,
  ) {}
  /**
   * 查询比赛列表
   */
  async queryEvents(options?: EventQueryOptions): Promise<EventListResult> {
    return this.eventService!.getEvents(options);
  }
  /**
   * 获取比赛详情（含分组）
   */
  async getEventDetail(eventId: number): Promise<EventDetail> {
    const groupsResult = await this.eventService!.getGroups(eventId);
    return {
      eventId,
      groups: groupsResult.groups,
    };
  }
  /**
   * 获取分组排名
   */
  async getGroupRanking(eventId: number, groupId: number, mode?: RankingMode, onProgress?: ProgressCallback, forceRefresh: boolean = false): Promise<RankingResult> {
    const allRounds = await this.eventService!.getAllRounds(groupId, onProgress, forceRefresh);
    return this.rankingCalculator!.calculate(allRounds.matches as MatchData[], mode);
  }
  /**
   * 获取对阵表
   */
  async getGroupMatches(groupId: number, bout?: number): Promise<AgainstPlanResult> {
    return this.eventService!.getAgainstPlan(groupId, bout ?? 1);
  }
  /**
   * 获取所有轮次对阵
   */
  async getAllRounds(groupId: number, onProgress?: ProgressCallback, forceRefresh: boolean = false): Promise<AllRoundsResult> {
    return this.eventService!.getAllRounds(groupId, onProgress, forceRefresh);
  }
  /**
   * 记录访问
   */
  async recordVisited(eventId: number, title: string): Promise<string> {
    return this.favoriteService!.addFavorite(
      'event',
      String(eventId),
      { title, visitedAt: Date.now() },
    );
  }
  /**
   * 查询访问历史
   */
  async queryHistory(options?: EventHistoryOptions): Promise<EventHistoryEntry[]> {
    if (!this.favoriteService) return [];
    const items = await this.favoriteService.getFavorites({ category: 'event' });
    const sorted = items.sort((a, b) => b.createdAt - a.createdAt);
    const limit = options?.limit ?? 20;
    return sorted.slice(0, limit).map(item => ({
      id: item.id,
      eventId: parseInt(item.key, 10),
      title: (item.data?.['title'] as string) ?? '',
      visitedAt: item.createdAt,
    }));
  }
  /**
   * 清空访问历史
   */
  async clearHistory(): Promise<void> {
    await this.favoriteService?.clear('event');
  }
  /**
   * 获取统计
   */
  async getStats(): Promise<EventStats> {
    if (!this.favoriteService) {
      return { total: 0, today: 0 };
    }
    const total = await this.favoriteService.count('event');
    return { total, today: 0 };
  }
}
