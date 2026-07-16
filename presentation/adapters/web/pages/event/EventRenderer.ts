/**
 * EventPage 首页渲染器
 * @description 通过 IAdapterFactory 组件接口管理布局和渲染
 * @module presentation/pages/event/EventRenderer
 *
 * 跨平台：只调接口方法，不直接操作 DOM。
 * 组件创建通过 IAdapterFactory，内容格式化通过 IEventFormatter。
 * 布局：tabs → queryPanel(areaSelect+monthSelect+input+button) / recentPanel(标题+清除+historyCard)
 */
import type { ICard, IInput, IButton, ITabs, IPanel, ISelect, IToast, IAdapterFactory } from '../../../../core/interfaces';
import type { IEventFormatter } from './IEventFormatter';
import type { EventHistoryEntry } from '../../../../../application/event';
import type { Event } from '../../../../../services/event/types';
/** 支持的比赛省份列表 */
export const EVENT_AREAS = [
  { value: '', label: '全国' },
  { value: '广东省', label: '广东省' },
  { value: '北京市', label: '北京市' },
  { value: '上海市', label: '上海市' },
  { value: '浙江省', label: '浙江省' },
  { value: '江苏省', label: '江苏省' },
];
export type EventAreaValue = (typeof EVENT_AREAS)[number]['value'];
export interface EventRendererCallbacks {
  onQuery: (area: string, month: number, keyword: string) => void;
  onTabChange: (tab: string) => void;
  onClearHistory: () => void;
  onViewHistory: (id: string) => void;
}
export class EventRenderer {
  readonly tabs: ITabs;
  readonly queryPanel: IPanel;
  readonly recentPanel: IPanel;
  readonly input: IInput;
  readonly areaSelect: ISelect;
  readonly monthSelect: ISelect;
  readonly queryBtn: IButton;
  readonly historyCard: ICard;
  readonly resultCard: ICard;
  readonly toast: IToast;
  constructor(
    private readonly cb: EventRendererCallbacks,
    private readonly factory: IAdapterFactory,
    private readonly formatter: IEventFormatter,
  ) {
    this.tabs = factory.createTabs();
    this.queryPanel = factory.createPanel();
    this.recentPanel = factory.createPanel();
    const qc = this.queryPanel.asContainer();
    this.areaSelect = factory.createSelect(qc);
    this.monthSelect = factory.createSelect(qc);
    this.input = factory.createInput(qc);
    this.queryBtn = factory.createButton(qc);
    const rc = this.recentPanel.asContainer();
    this.historyCard = factory.createCard(rc);
    this.resultCard = factory.createCard();
    this.toast = factory.createToast();
  }
  initialize(defaultArea?: string): void {
    this.tabs.setConfig({
      items: [
        { id: 'query', label: '🔍 查询' },
        { id: 'recent', label: '📋 最近' },
      ],
      activeId: 'query',
    });
    this.tabs.onChange((id) => {
      this.queryPanel.setVisible(id === 'query');
      this.recentPanel.setVisible(id === 'recent');
      this.cb.onTabChange(id);
    });
    this.queryPanel.setTitle('🔍 查询比赛');
    this.areaSelect.setOptions(EVENT_AREAS);
    // 优先使用传入的 defaultArea（IP 定位），后续 handleParams 会覆盖
    this.areaSelect.setValue(defaultArea && isValidArea(defaultArea) ? defaultArea : '广东省');
    this.monthSelect.setOptions([
      { value: '3', label: '最近3个月' },
      { value: '1', label: '最近1个月' },
      { value: '6', label: '最近半年' },
      { value: '12', label: '最近1年' },
    ]);
    this.monthSelect.setValue('1');
    this.input.setConfig({ placeholder: '关键词（可选）', maxLength: 50 });
    this.input.onEnter(() => this.doQuery());
    this.queryBtn.setText('开始查询');
    this.queryBtn.onClick(() => this.doQuery());
    this.recentPanel.setTitle('📋 最近访问');
    if (this.recentPanel.addAction) {
      this.recentPanel.addAction('🗑️ 清除', 'clearHistory');
    }
    this.recentPanel.onAction((action) => {
      if (action === 'clearHistory') this.cb.onClearHistory();
    });
    this.recentPanel.setVisible(false);
    this.resultCard.setVisible(false);
  }
  /** 设置区域选中值（由 handleParams 调用） */
  setArea(area: string): void {
    if (isValidArea(area)) {
      this.areaSelect.setValue(area);
    }
  }
  /** 设置月份选中值（由 handleParams 调用） */
  setMonth(month: number): void {
    this.monthSelect.setValue(String(month));
  }
  bindActions(): void {
    this.historyCard.onAction((action, data) => {
      if (action === 'viewHistory' && data?.['id']) {
        this.cb.onViewHistory(data['id']);
      }
    });
  }
  private doQuery(): void {
    const area = this.areaSelect.getValue() ?? '';
    const monthVal = this.monthSelect.getValue() ?? '1';
    const month = parseInt(monthVal, 10);
    const keyword = this.input.getValue().trim();
    this.cb.onQuery(area, isNaN(month) ? 1 : month, keyword);
  }
  showLoading(): void {
    this.queryBtn.setLoading(true);
    this.input.setDisabled(true);
    this.resultCard.setContent(this.formatter.formatLoading('正在查询比赛...'));
    this.resultCard.setVisible(true);
    this.resultCard.render();
  }
  hideLoading(): void {
    this.queryBtn.setLoading(false);
    this.queryBtn.setText('开始查询');
    this.input.setDisabled(false);
    this.resultCard.setVisible(false); // 隐藏"正在查询中"卡片
  }
  renderResult(result: { events: Event[]; total: number; area: string; month: number }): void {
    this.resultCard.setTitle('🏆 查询结果');
    if (result.events.length === 0) {
      this.resultCard.setContent(this.formatter.formatEmptyList('recent'));
    } else {
      const header = this.formatter.formatListHeader(result.area, result.month);
      const items = result.events.map((e, i) => this.formatter.formatEventCard(e, i)).join('\n\n');
      this.resultCard.setContent(`${header}\n\n${items}\n\n共 ${result.total} 场比赛`);
    }
    this.resultCard.setVisible(true);
    this.resultCard.render();
  }
  renderHistory(history: EventHistoryEntry[]): void {
    if (history.length === 0) {
      this.historyCard.setContent(this.formatter.formatEmptyHistory());
      return;
    }
    const items = history.slice(0, 20).map((e) => this.formatter.formatHistoryItem(e));
    this.historyCard.setContent(items.join('\n'));
  }
  render(): void {
    this.tabs.render();
    this.queryPanel.render();
    this.recentPanel.render();
  }
  destroy(): void {
    this.tabs.destroy();
    this.queryPanel.destroy();
    this.recentPanel.destroy();
    this.resultCard.destroy();
    this.toast.destroy();
  }
}
/** 校验省份是否在支持的列表中（导出供外部使用） */
export function isValidArea(area: string): boolean {
  return EVENT_AREAS.some((a) => a.value === area);
}
