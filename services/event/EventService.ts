/**
 * @fileoverview EventService 实现（赛事服务）
 */

import type { IEventService } from './IEventService';
import type {
  EventQueryOptions,
  EventListResult,
  GroupListResult,
  PlayerListResult,
  AgainstPlanResult,
  AllRoundsResult,
  ProgressCallback,
} from './types';
import { mapEvent, mapGroup, mapPlayer, mapMatch, isRoundCompleted } from './mappers';
import { extractGroupsFromHtml } from './HtmlParser';
import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { ICacheStorage } from '../../infrastructure/storage/interfaces/ICacheStorage';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { IEventConfig } from '../../infrastructure/config/schemas/EventConfigSchema';
import { ResourceCache } from '../../infrastructure/utils/cache';

const CACHE_PREFIX = 'event:';

export class EventService implements IEventService {
  private config: IEventConfig | null = null;
  private readonly roundsCache: ResourceCache<AllRoundsResult>;

  constructor(
    private readonly network: NetworkManager,
    private readonly cacheStorage: ICacheStorage,
    private readonly configProvider: IConfigProvider
  ) {
    this.roundsCache = new ResourceCache<AllRoundsResult>(cacheStorage, {
      keyPrefix: `${CACHE_PREFIX}rounds`,
      defaultTTL: 3600000, // 1小时
    });
  }

  async getEvents(options?: EventQueryOptions): Promise<EventListResult> {
    const config = await this.getConfig();
    const { area = '', month = 1, keyword = '', pageSize = 100 } = options || {};

    const params = new URLSearchParams({
      page: '1', eventType: '2', month: String(month),
      PageSize: String(Math.min(pageSize, 200)),
    });
    if (area) params.set('areaNum', area);

    let allEvents: ReturnType<typeof mapEvent>[] = [];
    let matched: ReturnType<typeof mapEvent>[] = [];
    let page = 1, totalPages = 1;

    while (page <= totalPages && page <= 10) {
      params.set('page', String(page));
      const url = this.buildUrl(config.eventsBaseUrl, params);
      const res = await this.request<{
        datArr?: { rows?: Record<string, unknown>[]; TotalPage?: number };
        rows?: Record<string, unknown>[]; TotalPage?: number;
      }>(url, config.timeout);

      const rows = res.datArr?.rows || res.rows || [];
      const events = rows.map(mapEvent);
      allEvents = allEvents.concat(events);
      if (keyword) {
        matched = matched.concat(events.filter(e => e.title.includes(keyword) || e.city.includes(keyword)));
      }
      totalPages = res.datArr?.TotalPage || res.TotalPage || 1;
      page++;
    }

    return { events: keyword ? matched : allEvents, total: keyword ? matched.length : allEvents.length };
  }

  async getGroups(eventId: number): Promise<GroupListResult> {
    // open.yunbisai.com API 返回 403，直接走 HTML 解析
    const config = await this.getConfig();
    return this.parseGroupsHtml(eventId, config);
  }

  async getGroupPlayers(eventId: number, groupId: number): Promise<PlayerListResult> {
    // open.yunbisai.com API 返回 403，无法获取选手列表
    return { players: [], total: 0 };
  }

  async getAgainstPlan(groupId: number, bout: number): Promise<AgainstPlanResult> {
    const config = await this.getConfig();
    const params = new URLSearchParams({ groupid: String(groupId), bout: String(bout) });
    const url = this.buildUrl(config.againstPlanBaseUrl, params);

    try {
      const res = await this.request<{
        error?: number; datArr?: { rows?: Record<string, unknown>[]; total_bout?: string | number };
      }>(url, config.timeout);
      if (res.error !== 0) return { rows: [], totalBout: 0, success: false, error: 'API error' };
      const rows = (res.datArr?.rows || []).map(r => mapMatch(r, bout));
      return { rows, totalBout: Number(res.datArr?.total_bout) || 0, success: true };
    } catch (e) {
      return { rows: [], totalBout: 0, success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getAllRounds(groupId: number, onProgress?: ProgressCallback, forceRefresh: boolean = false): Promise<AllRoundsResult> {
    const config = await this.getConfig();

    // 强制刷新时清除缓存
    if (forceRefresh) {
      await this.roundsCache.clear(String(groupId));
    }

    return this.roundsCache.getOrDownload(
      String(groupId),
      async () => {
        onProgress?.('加载第 1 轮对阵数据...', 10);
        const first = await this.getAgainstPlan(groupId, 1);
        if (!first.success || first.totalBout === 0) {
          return { matches: [], totalRounds: 0, completedRounds: 0 };
        }

        const totalRounds = first.totalBout;
        const matches = [...first.rows];
        let completed = isRoundCompleted(first.rows) ? 1 : 0;

        for (let bout = 2; bout <= totalRounds; bout++) {
          onProgress?.(`加载第 ${bout}/${totalRounds} 轮...`, 10 + Math.floor(((bout - 1) / totalRounds) * 70));
          const round = await this.getAgainstPlan(groupId, bout);
          if (!round.success) break;
          matches.push(...round.rows);
          if (isRoundCompleted(round.rows)) completed++;
        }

        onProgress?.('完成', 100);
        return { matches, totalRounds, completedRounds: completed };
      },
      config.eventCacheTTL
    );
  }

  async getAllRoundsFromCache(groupId: number): Promise<AllRoundsResult | null> {
    return this.cacheStorage.get(`${CACHE_PREFIX}rounds:${groupId}`);
  }

  async clearGroupCache(groupId: number): Promise<void> {
    await this.roundsCache.clear(String(groupId));
  }

  private async getConfig(): Promise<IEventConfig> {
    if (!this.config) this.config = await this.configProvider.getModuleConfig<IEventConfig>('event');
    return this.config;
  }

  /** 构建请求 URL（不处理代理，由网络层统一处理） */
  private buildUrl(baseUrl: string, params: URLSearchParams): string {
    return `${baseUrl}?${params}`;
  }

  private async request<T>(url: string, timeout: number): Promise<T> {
    const res = await this.network.request<T>({ url, method: 'GET', timeout });
    return res.data;
  }

  private async parseGroupsHtml(eventId: number, config: IEventConfig): Promise<GroupListResult> {
    const htmlUrl = `https://www.yunbisai.com/tpl/eventFeatures/eventDetail-${eventId}.html`;
    try {
      const html = await this.request<string>(htmlUrl, config.timeout);
      const groups = extractGroupsFromHtml(eventId, html);
      return { groups, total: groups.length, source: 'html' };
    } catch (e) {
      return { groups: [], total: 0, source: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }
  /** 搜索赛事 */
  async search(keyword: string): Promise<EventListResult> {
    return this.getEvents({ keyword });
  }
}
