/**
 * EventPage 首页渲染器
 * @description 通过 IAdapterFactory 组件接口管理布局和渲染
 * @module presentation/pages/event/EventRenderer
 *
 * 跨平台：只调接口方法，不直接操作 DOM。
 * 组件创建通过 IAdapterFactory，内容格式化通过 IEventFormatter。
 * 布局：tabs → queryPanel / importPanel / recentPanel
 */
import type { ICard, IInput, IButton, ITabs, IPanel, ISelect, IToast, IAdapterFactory } from '../../../../core/interfaces';
import type { IEventFormatter } from './IEventFormatter';
import type { EventHistoryEntry } from '../../../../../application/event';
import type { Event } from '../../../../../services/event/types';
import type { PdfEvent } from '../../../../../services/event/PdfEventTypes';

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

/** 最近Tab统一条目 */
export interface RecentEntry {
  id: string;
  title: string;
  source: 'cloud' | 'pdf';
  visitedAt: number;
  /** PDF专属 */
  groupCount?: number;
  roundCount?: number;
  /** 云比赛专属 */
  eventId?: number;
}

export interface EventRendererCallbacks {
  onQuery: (area: string, month: number, keyword: string) => void;
  onTabChange: (tab: string) => void;
  onClearHistory: () => void;
  onViewHistory: (id: string) => void;
  onImportFiles: (files: File[]) => void;
}

export class EventRenderer {
  readonly tabs: ITabs;
  readonly queryPanel: IPanel;
  readonly importPanel: IPanel;
  readonly recentPanel: IPanel;
  readonly input: IInput;
  readonly areaSelect: ISelect;
  readonly monthSelect: ISelect;
  readonly queryBtn: IButton;
  readonly importCard: ICard;
  readonly historyCard: ICard;
  readonly resultCard: ICard;
  readonly toast: IToast;
  private fileInput: HTMLInputElement | undefined;

  constructor(
    private readonly cb: EventRendererCallbacks,
    private readonly factory: IAdapterFactory,
    private readonly formatter: IEventFormatter,
  ) {
    this.tabs = factory.createTabs();
    this.queryPanel = factory.createPanel();
    this.importPanel = factory.createPanel();
    this.recentPanel = factory.createPanel();
    const qc = this.queryPanel.asContainer();
    this.areaSelect = factory.createSelect(qc);
    this.monthSelect = factory.createSelect(qc);
    this.input = factory.createInput(qc);
    this.queryBtn = factory.createButton(qc);
    const ic = this.importPanel.asContainer();
    this.importCard = factory.createCard(ic);
    const rc = this.recentPanel.asContainer();
    this.historyCard = factory.createCard(rc);
    this.resultCard = factory.createCard();
    this.toast = factory.createToast();
  }

  initialize(defaultArea?: string): void {
    this.tabs.setConfig({
      items: [
        { id: 'query', label: '🔍 查询' },
        { id: 'import', label: '📄 导入' },
        { id: 'recent', label: '📋 最近' },
      ],
      activeId: 'query',
    });
    this.tabs.onChange((id) => {
      this.queryPanel.setVisible(id === 'query');
      this.importPanel.setVisible(id === 'import');
      this.recentPanel.setVisible(id === 'recent');
      this.cb.onTabChange(id);
    });

    // 查询面板
    this.queryPanel.setTitle('🔍 查询比赛');
    this.areaSelect.setOptions(EVENT_AREAS);
    this.areaSelect.setValue(defaultArea && isValidArea(defaultArea) ? defaultArea : '');
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

    // 导入面板
    this.importPanel.setTitle('📄 导入对阵表');
    this.ensureFileInput();
    this.renderImportIdle();

    // 最近面板
    this.recentPanel.setTitle('📋 最近访问');
    if (this.recentPanel.addAction) {
      this.recentPanel.addAction('🗑️ 清除', 'clearHistory');
    }
    this.recentPanel.onAction((action) => {
      if (action === 'clearHistory') this.cb.onClearHistory();
    });

    this.importPanel.setVisible(false);
    this.recentPanel.setVisible(false);
    this.resultCard.setVisible(false);
  }

  private ensureFileInput(): void {
    if (this.fileInput) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.multiple = true;
    input.id = 'pdf-file-input';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      if (files.length > 0) {
        this.cb.onImportFiles(files);
        input.value = '';
      }
    });
    document.body.appendChild(input);
    this.fileInput = input;
  }

  /** 导入面板：空闲态 */
  private renderImportIdle(): void {
    this.importCard.setContent(`
      <div style="text-align:center;padding:30px 20px;">
        <div style="font-size:3em;margin-bottom:16px;opacity:0.5;">📄</div>
        <p style="color:#666;margin-bottom:20px;">选择PDF对阵表文件导入</p>
        <button id="pdf-choose-btn" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;border:none;padding:14px 40px;border-radius:12px;font-size:16px;font-weight:500;cursor:pointer;box-shadow:0 4px 15px rgba(102,126,234,0.4);">选择PDF文件</button>
      </div>
    `);
    this.importCard.render();
    // 绑定按钮
    setTimeout(() => {
      const btn = document.getElementById('pdf-choose-btn');
      if (btn) btn.addEventListener('click', () => this.fileInput?.click());
    }, 0);
  }

  /** 导入面板：进度态 */
  renderImportProgress(current: number, total: number, fileName: string): void {
    const pct = Math.round((current / total) * 100);
    this.importCard.setContent(`
      <div style="text-align:center;padding:30px 20px;">
        <div style="font-size:2em;margin-bottom:16px;">📂</div>
        <div style="font-weight:600;margin-bottom:12px;">导入 PDF（共${total}个文件）</div>
        <div style="background:#e5e7eb;border-radius:6px;height:6px;overflow:hidden;margin-bottom:12px;">
          <div style="height:100%;background:#3b82f6;border-radius:6px;transition:width 0.3s;width:${pct}%;"></div>
        </div>
        <div style="font-size:13px;color:#666;">正在解析 ${current + 1}/${total}：${esc(fileName)}</div>
      </div>
    `);
    this.importCard.render();
  }

  /** 导入面板：完成态 */
  renderImportDone(success: number, failed: number, total: number): void {
    const icon = failed > 0 ? '⚠️' : '✅';
    const label = failed > 0 ? '部分导入失败' : '导入完成';
    const color = failed > 0 ? '#f59e0b' : '#10b981';
    this.importCard.setContent(`
      <div style="text-align:center;padding:30px 20px;">
        <div style="font-size:2em;margin-bottom:12px;">${icon}</div>
        <div style="font-weight:600;color:#333;margin-bottom:8px;">${label}</div>
        <div style="font-size:13px;color:#666;">${success}成功${failed > 0 ? '，' + failed + '失败' : ''}，共${total}个文件</div>
      </div>
    `);
    this.importCard.render();
    // 2秒后恢复空闲态
    setTimeout(() => this.renderImportIdle(), 2000);
  }

  /** 设置区域选中值 */
  setArea(area: string): void {
    if (isValidArea(area)) {
      this.areaSelect.setValue(area);
    }
  }

  /** 设置月份选中值 */
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
    /** 从外部切换Tab（含面板可见性） */
  showTab(tabId: string): void {
    this.queryPanel.setVisible(tabId === "query");
    this.importPanel.setVisible(tabId === "import");
    this.recentPanel.setVisible(tabId === "recent");
    this.tabs.setActiveId(tabId);
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
    this.resultCard.setVisible(false);
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

  /** 渲染最近Tab：合并云比赛 + PDF导入 */
  renderRecent(entries: RecentEntry[]): void {
    if (entries.length === 0) {
      this.historyCard.setContent(this.formatter.formatEmptyHistory());
      return;
    }
    const items = entries.slice(0, 20).map(e => {
      if (e.source === 'pdf') {
        return this.formatPdfRecentItem(e);
      }
      return this.formatter.formatHistoryItem({
        id: e.id,
        eventId: e.eventId ?? 0,
        title: e.title,
        visitedAt: e.visitedAt,
      });
    });
    this.historyCard.setContent(items.join('\n'));
  }

  private formatPdfRecentItem(entry: RecentEntry): string {
    const time = fmtRelTime(entry.visitedAt);
    let info = '';
    if (entry.groupCount) info += `${entry.groupCount}个分组`;
    if (entry.roundCount) info += (info ? ' · ' : '') + `${entry.roundCount}轮`;
    const infoHtml = info ? `<div style="font-size:0.8em;color:#888;margin-top:2px;">${info}</div>` : '';
    return `<div data-action="viewHistory" data-id="${esc(entry.id)}" style="background:white;border-radius:12px;padding:16px;margin-bottom:8px;cursor:pointer;transition:transform 0.2s;box-shadow:0 4px 15px rgba(0,0,0,0.1);"><div style="font-weight:600;color:#333;margin-bottom:2px;">🏆 ${esc(entry.title)}</div>${infoHtml}<div style="font-size:0.75em;color:#ccc;margin-top:4px;">🕐 ${time}</div></div>`;
  }

  render(): void {
    this.tabs.render();
    this.queryPanel.render();
    this.importPanel.render();
    this.recentPanel.render();
  }

  destroy(): void {
    this.tabs.destroy();
    this.queryPanel.destroy();
    this.importPanel.destroy();
    this.recentPanel.destroy();
    this.resultCard.destroy();
    this.toast.destroy();
    if (this.fileInput) {
      this.fileInput.remove();
      this.fileInput = undefined;
    }
  }
}

/** 校验省份是否在支持的列表中 */
export function isValidArea(area: string): boolean {
  return EVENT_AREAS.some((a) => a.value === area);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtRelTime(ts: number): string {
  const d = Date.now() - ts, m = Math.floor(d / 60000);
  if (m < 1) return '刚刚'; if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}小时前`;
  const dy = Math.floor(h / 24); if (dy < 7) return `${dy}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
