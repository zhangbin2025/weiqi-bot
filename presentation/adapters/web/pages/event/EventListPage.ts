/** 云比赛赛事列表页面控制器 */
import type { IPage, PageParams, IAdapterFactory } from '../../../../core/interfaces';
import type { IPageCache } from '../../../../core/interfaces/IPageCache';
import type { EventQuerier, EventHistoryEntry } from '../../../../../application/event';
import type { IEventFormatter } from './IEventFormatter';
import type { Event, EventListResult } from '../../../../../services/event/types';
import { EventListRenderer } from './EventListRenderer';
export interface EventListPageConfig {
  eventQuerier: EventQuerier;
  adapterFactory: IAdapterFactory; formatter: IEventFormatter;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  onSelectEvent?: (eventId: number, title: string) => void;
  /** 页面缓存（可选，用于返回导航时恢复数据） */
  pageCache?: IPageCache;
}
interface ListCache {
  events: Event[]; query: { area?: string; month?: string; keyword?: string };
  currentTab: string; timestamp: number;
}
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY = 'event-list';
type ListTab = 'recent' | 'history' | 'future';
export class EventListPage implements IPage {
  readonly title = '赛事列表';
  private q!: EventQuerier;
  private nav?: ((p: string, ps?: Record<string, string>) => void) | undefined;
  private selFn?: ((id: number, t: string) => void) | undefined;
  private cache?: IPageCache | undefined;
  private events: Event[] = [];
  private history: EventHistoryEntry[] = [];
  private curTab: ListTab = 'recent';
  private query: { area?: string; month?: string; keyword?: string } = {};
  private init = false; private renderer: EventListRenderer;
  constructor(c: EventListPageConfig) {
    this.q = c.eventQuerier;
    this.nav = c.onNavigate; this.selFn = c.onSelectEvent; this.cache = c.pageCache;
    this.renderer = new EventListRenderer({
      onSelectEvent: (id, t) => this.selectEvent(id, t),
      onTabChange: (tab) => { this.curTab = tab as ListTab; this.renderTab(); },
    }, c.adapterFactory, c.formatter);
  }
  async initialize(): Promise<void> {
    if (this.init) return;
    this.renderer.initialize(); this.renderer.bindActions();
    await this.loadHistory();
    this.init = true;
  }
  handleParams(p: PageParams): void {
    this.query = {};
    if (p['area']) this.query.area = p['area'];
    if (p['month']) this.query.month = p['month'];
    if (p['keyword']) this.query.keyword = p['keyword'];
  }
  async loadEvents(query: { area?: string; month?: string; keyword?: string }): Promise<void> {
    this.query = query;
    // 先尝试从缓存恢复
    if (this.tryCache(query)) return;
    await this.fetchEvents();
  }
  private async fetchEvents(): Promise<void> {
    try {
      const month = this.query.month ? parseInt(this.query.month, 10) : 1;
      const opts: { month: number; area?: string; keyword?: string } = { month: isNaN(month) ? 1 : month };
      if (this.query.area) opts.area = this.query.area;
      if (this.query.keyword) opts.keyword = this.query.keyword;
      const result: EventListResult = await this.q.queryEvents(opts);
      this.events = result.events;
      this.updateCounts(); this.renderTab();
      this.renderer.renderHeader();
      this.saveCache();
    } catch (e) { console.error('加载比赛列表失败', e as Error); this.renderer.toast.error('加载失败'); }
  }
  private saveCache(): void {
    if (!this.cache) return;
    this.cache.set(CACHE_KEY, JSON.stringify({
      events: this.events, query: this.query, currentTab: this.curTab, timestamp: Date.now(),
    } as ListCache));
  }
  private tryCache(query: { area?: string; month?: string; keyword?: string }): boolean {
    if (!this.cache) return false;
    const raw = this.cache.get(CACHE_KEY);
    if (!raw) return false;
    try {
      const c: ListCache = JSON.parse(raw);
      if (Date.now() - c.timestamp > CACHE_TTL) { this.cache.remove(CACHE_KEY); return false; }
      // 查询条件必须一致才恢复
      if (c.query.area !== query.area || c.query.month !== query.month || c.query.keyword !== query.keyword)
        return false;
      this.events = c.events; this.curTab = c.currentTab as ListTab;
      this.updateCounts(); this.renderTab();
      const month = this.query.month ? parseInt(this.query.month, 10) : 1;
      this.renderer.renderHeader();
      return true;
    } catch { return false; }
  }
  private updateCounts(): void {
    const { recent, history, future } = this.categorize();
    this.renderer.setTabCounts(recent.length, history.length, future.length);
  }
  private categorize(): { recent: Event[]; history: Event[]; future: Event[] } {
    const today = new Date().toISOString().split('T')[0] ?? '';
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] ?? '';
    const recent = this.events.filter((e) => e.date && e.date >= weekAgo && e.date <= today);
    const history = this.events.filter((e) => e.date && e.date < weekAgo);
    const future = this.events.filter((e) => e.date && e.date > today);
    return { recent, history, future };
  }
  private filtered(): Event[] {
    const { recent, history, future } = this.categorize();
    switch (this.curTab) {
      case 'recent': return recent; case 'history': return history; case 'future': return future;
      default: return this.events;
    }
  }
  private async loadHistory(): Promise<void> {
    try { this.history = await this.q.queryHistory({ limit: 20 }); }
    catch (e) { console.error('加载历史失败', e as Error); this.history = []; }
  }
  private renderTab(): void { this.renderer.renderEvents(this.filtered(), this.curTab); }
  private async selectEvent(id: number, title: string): Promise<void> {
    try { await this.q.recordVisited(id, title); } catch { /* 记录失败不影响导航 */ }
    if (this.selFn) this.selFn(id, title);
    else if (this.nav) this.nav('event/detail', { eventId: String(id), title });
  }
  render(): void { this.renderer.render(); this.renderTab(); }
  destroy(): void {
    this.renderer.destroy(); this.events = []; this.history = []; this.init = false;
  }
}
