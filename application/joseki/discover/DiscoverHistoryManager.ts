/**
 * 定式发现历史管理器
 * @description 管理发现历史的查询、统计、清理
 */
import type { IFavoriteService } from '../../../services/favorite';
import type { IDiscoveredPattern } from '../../../services/joseki/discover/types';
/** 游戏简略信息 */
export interface GameInfo {
  archiveId: string;
  black: string;
  white: string;
  date: string;
  result: string;
}
/** 发现历史查询选项 */
export interface DiscoverHistoryOptions {
  source?: string;
  date?: string;
  limit?: number;
  offset?: number;
}
/** 发现历史条目 */
export interface DiscoverHistoryEntry {
  id: string;
  label: string;
  source: string;
  gamesCount: number;
  patternsFound: number;
  games: GameInfo[];
  patterns: IDiscoveredPattern[];
  discoveredAt: number;
  category: string;
  key: string;
}
/** 发现统计 */
export interface DiscoverStats {
  total: number;
  today: number;
  topPatterns: string[];
}
/**
 * 定式发现历史管理器
 */
export class DiscoverHistoryManager {
  constructor(private readonly favoriteService?: IFavoriteService) {}
  /** 查询发现历史 */
  async queryHistory(options?: DiscoverHistoryOptions): Promise<DiscoverHistoryEntry[]> {
    if (!this.favoriteService) return [];
    const query: any = { category: 'joseki_discover' };
    const items = await this.favoriteService.getFavorites(query);
    let entries = items.map((item: any) => {
      const data = item.data as any;
      return {
        id: item.id,
        label: data.label || item.note || '',
        source: data.source || 'unknown',
        gamesCount: data.gamesCount || 0,
        patternsFound: data.patternsFound || 0,
        games: (data.games || []) as GameInfo[],
        patterns: (data.patterns || []) as IDiscoveredPattern[],
        discoveredAt: item.createdAt,
        category: item.category,
        key: item.key,
      };
    });
    // 按来源过滤
    if (options?.source) {
      entries = entries.filter((e: DiscoverHistoryEntry) => e.source === options.source);
    }
    // 按日期过滤
    if (options?.date) {
      entries = entries.filter((e: DiscoverHistoryEntry) => {
        const data = items.find((i: any) => i.id === e.id)?.data as any;
        return data?.date === options.date;
      });
    }
    // 分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 20;
    return entries.slice(offset, offset + limit);
  }
  /** 获取单条历史详情 */
  async getHistoryDetail(id: string): Promise<DiscoverHistoryEntry | null> {
    const items = (await this.favoriteService?.getFavorites({ category: 'joseki_discover' })) ?? [];
    
    // 统一使用 key 查找
    const item = items.find(i => i.key === id);
    
    if (!item) return null;
    const data = item.data as any;
    const result: DiscoverHistoryEntry = {
      id: item.id,
      label: data.label ?? '',
      source: data.source ?? 'unknown',
      gamesCount: data.gamesCount ?? 0,
      patternsFound: data.patternsFound ?? 0,
      games: (data.games ?? []) as GameInfo[],
      patterns: (data.patterns ?? []) as IDiscoveredPattern[],
      discoveredAt: item.createdAt,
      category: item.category,
      key: item.key,
    };
    return result;
  }
  /** 清除发现历史 */
  async clearHistory(): Promise<void> {
    await this.favoriteService?.clear('joseki_discover');
  }
  /** 获取统计信息 */
  async getStats(): Promise<DiscoverStats> {
    const items = (await this.favoriteService?.getFavorites({ category: 'joseki_discover' })) ?? [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    let todayCount = 0;
    const patternCounts = new Map<string, number>();
    for (const item of items) {
      const data = item.data as any;
      const itemDate = new Date(item.createdAt).toISOString().slice(0, 10);
      if (itemDate === todayStr) {
        todayCount++;
      }
      const patterns = data.patterns as IDiscoveredPattern[] | undefined;
      patterns?.forEach(p => patternCounts.set(p.prefix, (patternCounts.get(p.prefix) ?? 0) + p.frequency));
    }
    const topPatterns = Array.from(patternCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([prefix]) => prefix);
    return { total: items.length, today: todayCount, topPatterns };
  }
}
