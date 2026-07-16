/**
 * 云比赛首页控制器
 * @module presentation/pages/event/EventPage
 */
import type { IPage, PageParams, IAdapterFactory } from '../../../../core/interfaces';
import type { EventQuerier, EventHistoryEntry } from '../../../../../application/event';
import type { IIpGeoQuerier } from '../../../../../application/event/IpGeoQuerier';
import type { IEventFormatter } from './IEventFormatter';
import { EventRenderer } from './EventRenderer';
type EventTab = 'query' | 'recent';
export interface EventPageConfig {
  eventQuerier: EventQuerier;
  ipGeoQuerier: IIpGeoQuerier | undefined;
  adapterFactory: IAdapterFactory;
  formatter: IEventFormatter;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class EventPage implements IPage {
  readonly title = '云比赛';
  private eventQuerier: EventQuerier;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private area: string = '广东省';
  private month: number = 1;
  private keyword: string = '';
  private initialized = false;
  private currentTab: EventTab = 'query';
  private history: EventHistoryEntry[] = [];
  private renderer: EventRenderer;
  private ipGeoQuerier: IIpGeoQuerier | undefined;
  constructor(config: EventPageConfig) {
    this.eventQuerier = config.eventQuerier;
    this.ipGeoQuerier = config.ipGeoQuerier;
    this.onNavigate = config.onNavigate;
    this.renderer = new EventRenderer(
      {
        onQuery: (area, month, keyword) => this.queryEvents(area, month, keyword),
        onTabChange: (tab) => this.switchTab(tab as EventTab),
        onClearHistory: () => this.clearHistory(),
        onViewHistory: (id) => this.viewHistory(id),
      },
      config.adapterFactory,
      config.formatter,
    );
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    // 尝试通过 IP 定位获取用户省份，作为默认选中值
    let province: string | undefined;
    if (this.ipGeoQuerier) {
      try {
        province = await this.ipGeoQuerier.fetchProvince();
        console.info('IP 定位省份', { province });
      } catch (e) {
        console.warn('IP 定位失败，使用默认省份', e as Error);
      }
    }
    this.renderer.initialize(province);
    this.renderer.bindActions();
    this.initialized = true;
  }
  handleParams(params: PageParams): void {
    if (params['keyword']) {
      this.keyword = params['keyword'];
      this.renderer.input.setValue(params['keyword']);
    }
    if (params['area']) {
      this.area = params['area'];
      this.renderer.setArea(params['area']);
    }
    if (params['month']) {
      const m = parseInt(params['month'], 10);
      if (!isNaN(m)) {
        this.month = m;
        this.renderer.setMonth(m);
      }
    }
  }
  async switchTab(tabName: EventTab): Promise<void> {
    this.currentTab = tabName;
    if (tabName === 'recent') await this.loadHistory();
    this.renderer.renderHistory(this.history);
  }
  private async loadHistory(): Promise<void> {
    try {
      this.history = await this.eventQuerier.queryHistory({ limit: 20 }) ?? [];
    } catch {
      this.history = [];
    }
  }
  async clearHistory(): Promise<void> {
    await this.eventQuerier.clearHistory();
    this.history = [];
    this.renderer.renderHistory([]);
    this.renderer.toast.success('历史记录已清除');
  }
  private async viewHistory(id: string): Promise<void> {
    const entry = this.history.find((h) => h.id === id);
    if (!entry) return;
    if (this.onNavigate) {
      this.onNavigate('event/detail', {
        eventId: String(entry.eventId),
        title: entry.title,
      });
    }
  }
  private async queryEvents(area: string, month: number, keyword: string): Promise<void> {
    this.area = area;
    this.month = month;
    this.renderer.showLoading();
    try {
      const result = await this.eventQuerier.queryEvents({ area, month, keyword });
      console.info('查询比赛', { area, month, keyword, count: result.total });
      if (this.onNavigate) {
        this.onNavigate('event/list', { area, month: String(month), keyword });
      }
    } catch (error) {
      console.error('查询比赛失败', error as Error);
      this.renderer.toast.error('查询失败');
    } finally {
      this.renderer.hideLoading();
    }
  }
  render(): void { this.renderer.render(); }
  /** 触发查询（供 URL 参数 auto=true 时调用） */
  async triggerQuery(): Promise<void> {
    await this.queryEvents(this.area, this.month, this.keyword);
  }
  destroy(): void {
    this.renderer.destroy();
    this.history = [];
    this.initialized = false;
  }
}
