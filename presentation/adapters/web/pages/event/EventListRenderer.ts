/**
 * EventListPage 列表页渲染器
 * @description 完全对齐 joseki/list.html 风格
 * @module presentation/pages/event/EventListRenderer
 */
import type { ICard, IToast, IAdapterFactory } from '../../../../core/interfaces';
import type { IEventFormatter } from './IEventFormatter';
import type { Event } from '../../../../../services/event/types';
export interface EventListRendererCallbacks {
  onSelectEvent: (eventId: number, title: string) => void;
  onTabChange: (tab: string) => void;
}
interface TabDef {
  id: string;
  label: string;
  count: number;
}
export class EventListRenderer {
  readonly headerCard: ICard;
  readonly listCard: ICard;
  readonly toast: IToast;
  private tabs: TabDef[] = [
    { id: 'recent', label: '🔥 最近', count: 0 },
    { id: 'history', label: '📜 历史', count: 0 },
    { id: 'future', label: '📅 未来', count: 0 },
  ];
  private activeId = 'recent';
  constructor(
    private readonly cb: EventListRendererCallbacks,
    private readonly factory: IAdapterFactory,
    private readonly formatter: IEventFormatter,
  ) {
    this.headerCard = factory.createCard();
    this.listCard = factory.createCard();
    this.toast = factory.createToast();
  }
  initialize(): void {
    this.headerCard.setConfig({ padding: 'none', elevation: 'none' });
    this.renderFilterTabs();
  }
  bindActions(): void {
    this.listCard.onAction((action, data) => {
      if (action === 'selectEvent' && data?.['id'] && data?.['title']) {
        this.cb.onSelectEvent(Number(data['id']), String(data['title']));
      }
    });
  }
  setTabCounts(recent: number, history: number, future: number): void {
    this.tabs = [
      { id: 'recent', label: '🔥 最近', count: recent },
      { id: 'history', label: '📜 历史', count: history },
      { id: 'future', label: '📅 未来', count: future },
    ];
    this.renderFilterTabs();
  }
  private renderFilterTabs(): void {
    const el = document.getElementById('filter-tabs');
    if (!el) return;
    el.innerHTML = '';
    this.tabs.forEach((tab) => {
      const btn = document.createElement('div');
      btn.className = 'filter-tab' + (tab.id === this.activeId ? ' active' : '');
      btn.innerHTML = `${tab.label}${tab.count > 0 ? `<span class="count"> ${tab.count}</span>` : ''}`;
      btn.addEventListener('click', () => {
        this.activeId = tab.id;
        this.renderFilterTabs();
        this.cb.onTabChange(tab.id);
      });
      el.appendChild(btn);
    });
  }
  renderEvents(events: Event[], tab: string): void {
    if (events.length === 0) {
      this.listCard.setContent(this.formatter.formatEmptyList(tab));
      this.listCard.render();
      return;
    }
    const cityGroups: Record<string, Event[]> = {};
    events.forEach((e) => {
      const city = e.city || '未知地区';
      if (!cityGroups[city]) cityGroups[city] = [];
      cityGroups[city].push(e);
    });
    const html = Object.entries(cityGroups)
      .map(([city, evts]) => this.formatter.formatCityGroup(city, evts))
      .join('\n');
    this.listCard.setContent(html);
    this.listCard.render();
  }
  renderHeader(): void {
    this.headerCard.setConfig({ padding: 'none', elevation: 'none' });
  }
  render(): void {
    this.listCard.render();
  }
  destroy(): void {
    this.headerCard.destroy();
    this.listCard.destroy();
    this.toast.destroy();
  }
}
