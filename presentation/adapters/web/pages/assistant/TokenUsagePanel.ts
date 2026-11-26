/**
 * Token 消耗面板（AI 对话页右上角菜单第 7 项）
 * @module presentation/adapters/web/pages/assistant/TokenUsagePanel
 *
 * 界面刻意保持简单：一个弹窗、一条时间段切换条、主要就是消耗数据。
 * - 总览：合计 / 上行 / 下行 / 请求数（未上报用量单列提示）
 * - 「按提供商 / 模型」卡片式条目（一行一个模型，窄屏不换行挤压）
 * - 「按用途」一行简要（task 维度用得上但不占版面）
 * - 趋势：今日 / 昨日按小时 24 桶，最近 7 / 30 天按天；堆叠柱高度线性归一化
 * - 「清除统计」在弹窗按钮栏与「关闭」并列（内联二次确认，不嵌套单例 WebDialog）
 *
 * 数字一律走 formatTokenCount（K/M 紧凑单位）展示；tooltip 里给精确值
 * exactTokenCount，避免缩写舍入让「分项相加 ≠ 总数」看起来像统计错误。
 * 所有动态文本（provider host / 模型名 / task）一律 escapeHtml 后再进 innerHTML。
 */

import type { WebDialog } from '../../components/Dialog';
import type { TokenUsageStore } from '../../../../../infrastructure/token/TokenUsageStore';
import {
  TOKEN_RANGE_LABELS,
  type TokenRangeId, type TokenStats, type TokenTrendPoint,
} from '../../../../../application/token/TokenUsageTypes';
import {
  computeTokenStats, formatTokenCount, exactTokenCount, rangeBounds,
  MODEL_KEY_SEP,
} from '../../../../../application/token/TokenUsageStats';
import { loadTokenRetentionDays } from '../../../../../application/token/TokenUsageConfig';

const RANGE_ORDER: readonly TokenRangeId[] = ['today', 'yesterday', 'last7', 'last30'];

/** 用途标签的中文显示；未登记的任务直接显示原 id，不硬造映射 */
const TASK_LABELS: Readonly<Record<string, string>> = {
  'chat.reply': '对话',
  'chat.title': '会话标题',
  'chat.compact': '上下文压缩',
  'skill.route': '技能路由',
  'plugin.generate': '插件生成',
  intent: '意图识别',
  unspecified: '未标注',
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 数字单元：K/M 显示 + 精确值 tooltip */
function tokenCell(n: number): string {
  return `<span title="${exactTokenCount(n)} tokens">${formatTokenCount(n)}</span>`;
}

export class TokenUsagePanel {
  private range: TokenRangeId = 'last7';
  /** 面板刷新序号：异步读取期间用户可能关掉/重开，旧结果必须丢弃 */
  private seq = 0;

  constructor(
    private readonly dialog: WebDialog,
    private readonly store: TokenUsageStore,
  ) {}

  async open(): Promise<void> {
    // show() 是阻塞式 Promise（点关闭才 resolve），DOM 同步插入；
    // 先发起显示再绑定/填充，与 showHistory / showPluginPanel 同一套路。
    void this.dialog.show({
      type: 'custom',
      title: 'Token 消耗',
      content:
        '<div class="tk-panel" id="tkPanelRoot">'
        + '<div class="tk-ranges" id="tkRanges"></div>'
        + '<div class="tk-body" id="tkBody">正在读取统计…</div>'
        + '</div>',
      buttons: [
        { id: 'close', text: '关闭' },
        { id: 'clear', text: '清除统计', keepOpen: true },
      ],
    });
    this.bindRanges();
    // 按钮在 show() 里同步插入 DOM，此时可绑定；清除沿用内联二次确认，
    // 不嵌套单例 WebDialog、不依赖 window.confirm。
    this.bindClear();
    await this.refresh();
  }

  private bindRanges(): void {
    const bar = document.getElementById('tkRanges');
    if (!bar) return;
    bar.innerHTML = RANGE_ORDER.map((id) =>
      `<button type="button" class="tk-range${id === this.range ? ' tk-range--on' : ''}" data-range="${id}">${TOKEN_RANGE_LABELS[id]}</button>`,
    ).join('');
    bar.querySelectorAll<HTMLButtonElement>('.tk-range').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset['range'] as TokenRangeId | undefined;
        if (!next || !RANGE_ORDER.includes(next)) return;
        this.range = next;
        bar.querySelectorAll<HTMLButtonElement>('.tk-range').forEach((b) =>
          b.classList.toggle('tk-range--on', b.dataset['range'] === next));
        void this.refresh();
      });
    });
  }

  private async refresh(): Promise<void> {
    const seq = ++this.seq;
    const body = document.getElementById('tkBody');
    if (!body) return;
    const now = Date.now();
    // retention 是 loadRangeAndPrune 的数据裁剪参数（保留多少天），与界面显示无关。
    const retention = loadTokenRetentionDays();
    // 一次读够最宽窗口（最近 30 天），切时间段只重算不重读。
    const widest = rangeBounds('last30', now);
    let stats: TokenStats;
    try {
      const records = await this.store.loadRangeAndPrune(
        widest.fromDate, widest.toDate, retention, now,
      );
      stats = computeTokenStats(records, this.range, now);
    } catch {
      if (seq !== this.seq) return;
      body.innerHTML = '<div class="tk-empty">统计读取失败，请稍后重试。</div>';
      return;
    }
    if (seq !== this.seq) return;
    body.innerHTML = this.renderStats(stats);
  }

  private renderStats(s: TokenStats): string {
    const t = s.total;
    const notes: string[] = [];
    if (t.unreported > 0) {
      notes.push(`<div class="tk-note">⚠️ ${t.unreported} 次请求端点未上报 usage，token 记为 0，未计入下方合计。</div>`);
    }
    // 恒等式自检：Σ 分用途 应恰好等于总消耗。false 只可能来自坏分片/旧数据，
    // 明确告诉用户「以总消耗为准」，避免把异常分项当真（可清空统计重建）。
    if (!s.consistent) {
      notes.push('<div class="tk-note">⚠️ 分用途合计与总消耗不一致（可能是旧版本残留数据）。请以「总消耗」为准；可执行「清除统计」后重新累计。</div>');
    }
    return [
      `<div class="tk-summary">`,
      `<div class="tk-summary__main"><span>总消耗</span><strong title="${exactTokenCount(t.totalTokens)} tokens">${formatTokenCount(t.totalTokens)}</strong><span>tokens</span></div>`,
      `<div class="tk-summary__sub">上行 ${tokenCell(t.promptTokens)} · 下行 ${tokenCell(t.completionTokens)} · ${t.requests} 次请求</div>`,
      `</div>`,
      ...notes,
      `<div class="tk-section-title">按提供商 / 模型</div>`,
      this.renderModelCards(s),
      `<div class="tk-section-title">按用途</div>`,
      this.renderTaskLine(s),
      `<div class="tk-section-title">消耗趋势（${escapeHtml(s.fromDate)} ~ ${escapeHtml(s.toDate)}，${s.hourly ? '按小时' : '按天'}）</div>`,
      this.renderTrend(s),
    ].join('');
  }

  /**
   * 卡片式条目：一个模型一张卡，不再用表格。
   * 窄屏下表格六列会把 provider / model 挤成多行，卡片把「标识」与「数字」分层：
   * 头部 provider + model（可换行但不与数字抢同一行），下面一行小字给
   * 次数 / 上行 / 下行 / 合计，合计用主色强调。长 host / 模型名靠 word-break 折叠。
   */
  private renderModelCards(s: TokenStats): string {
    if (s.byModel.length === 0) return '<div class="tk-empty">该时间段暂无请求</div>';
    const cards = s.byModel.map((r) => {
      const [provider, model] = r.key.split(MODEL_KEY_SEP);
      return `<div class="tk-card">`
        + `<div class="tk-card__head">`
        + `<span class="tk-card__provider" title="${escapeHtml(provider ?? '')}">${escapeHtml(provider ?? '')}</span>`
        + `<span class="tk-card__sep">›</span>`
        + `<span class="tk-card__model" title="${escapeHtml(model ?? '')}">${escapeHtml(model ?? '')}</span>`
        + `</div>`
        + `<div class="tk-card__metrics">`
        + `<span>${r.requests} 次</span>`
        + `<span>上行 ${tokenCell(r.promptTokens)}</span>`
        + `<span>下行 ${tokenCell(r.completionTokens)}</span>`
        + `<span class="tk-card__total">合计 ${tokenCell(r.totalTokens)}</span>`
        + `</div>`
        + `</div>`;
    }).join('');
    return `<div class="tk-cards">${cards}</div>`;
  }

  private renderTaskLine(s: TokenStats): string {
    if (s.byTask.length === 0) return '<div class="tk-empty">—</div>';
    return `<div class="tk-tasks">${s.byTask.map((r) =>
      `<span class="tk-task" title="${exactTokenCount(r.totalTokens)} tokens">${escapeHtml(TASK_LABELS[r.key] ?? r.key)} ${formatTokenCount(r.totalTokens)}</span>`,
    ).join('')}</div>`;
  }

  private renderTrend(s: TokenStats): string {
    // 高度按窗口内最大单桶合计线性归一化；max=0 时全为 0 高，不做任何估算。
    const max = s.trend.reduce((m, d) => Math.max(m, d.totalTokens), 0);
    const n = s.trend.length;
    // X 轴刻度按明确的时间单位显示（业务规则，不是几何估算）：
    //   - 今日 / 昨日按小时：每 4 小时一刻度 → 0 / 4 / 8 / 12 / 16 / 20
    //   - 按天（最近 30 天）：每 7 天一刻度 → 首日、+7、+14、+21、+28
    //   - 最近 7 天只有 7 桶，窄屏每柱约 31px，逐柱标 DD 也放得下，故间隔取 1
    // 柱子由 CSS flex 均分（min-width:0，无横向滚动）；刻度绝对定位、不占柱宽，
    // 所以标签长短不会影响柱子能否放下。精确时间仍在各柱 tooltip 与趋势标题里。
    const tickStep = s.hourly ? 4 : (n > 7 ? 7 : 1);
    const lastTick = Math.floor((n - 1) / tickStep) * tickStep;
    const tickLabel = (d: TokenTrendPoint): string => {
      if (s.hourly) return String(Number(d.label));              // "04" → "4"
      if (tickStep > 1) return d.date.slice(5).replace('-', '/'); // "2026-10-28" → "10/28"
      return d.label;                                            // "28"（日号 DD）
    };
    const cols = s.trend.map((d, i) => {
      const pHeight = max > 0 ? (d.promptTokens / max) * 100 : 0;
      const cHeight = max > 0 ? (d.completionTokens / max) * 100 : 0;
      const isTick = i % tickStep === 0;
      // 首尾刻度改为左 / 右对齐：居中会让半个 label 溢出柱区，
      // 而 .tk-body 的 overflow-x 会由 overflow-y:scroll 推导成 auto，
      // 这点溢出就可能重新冒出横向滚动条。钳制后 label 完全落在柱区内。
      const alignCls = isTick && i === 0 ? ' tk-col__label--first'
        : isTick && i === lastTick ? ' tk-col__label--last' : '';
      const label = isTick
        ? `<div class="tk-col__label${alignCls}">${escapeHtml(tickLabel(d))}</div>` : '';
      return `<div class="tk-col" title="${escapeHtml(this.trendTooltip(d, s.hourly))}">`
        + `<div class="tk-bar-wrap">`
        + `<div class="tk-bar tk-bar--completion" style="height:${cHeight.toFixed(2)}%"></div>`
        + `<div class="tk-bar tk-bar--prompt" style="height:${pHeight.toFixed(2)}%"></div>`
        + `</div>${label}</div>`;
    }).join('');
    const peakUnit = s.hourly ? '小时' : '日';
    return `<div class="tk-trend${s.hourly ? ' tk-trend--hourly' : ''}">${cols}</div>`
      + '<div class="tk-legend"><span class="tk-legend__in">■ 上行</span><span class="tk-legend__out">■ 下行</span>'
      + (max > 0 ? `<span>峰值 ${formatTokenCount(max)} / ${peakUnit}</span>` : '') + '</div>';
  }

  private trendTooltip(d: TokenTrendPoint, hourly: boolean): string {
    const when = hourly ? `${d.date} ${d.label}:00` : d.date;
    return `${when}：合计 ${exactTokenCount(d.totalTokens)}（上行 ${exactTokenCount(d.promptTokens)} / 下行 ${exactTokenCount(d.completionTokens)}），${d.requests} 次请求`;
  }

  private bindClear(): void {
    // 限定在本面板所在弹窗内查找，避免命中其他 WebDialog 实例的同名按钮。
    const root = document.getElementById('tkPanelRoot');
    const btn = root?.closest('.web-dialog')
      ?.querySelector<HTMLButtonElement>('.web-dialog__btn[data-btn-id="clear"]');
    if (!btn) return;
    // 该按钮声明了 keepOpen，Dialog 组件不会因点击而关闭弹窗；
    // 这里只展开内联二次确认条，确认后才真正清库并刷新。
    btn.classList.add('web-dialog__btn--danger');
    btn.addEventListener('click', () => {
      const bar = btn.parentElement;
      if (!bar || bar.querySelector('.tk-confirm')) return;
      const confirm = document.createElement('div');
      confirm.className = 'tk-confirm';
      const text = document.createElement('span');
      text.textContent = '确定清除全部 Token 统计？此操作不可恢复。';
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.textContent = '确定清除';
      const no = document.createElement('button');
      no.type = 'button';
      no.textContent = '取消';
      no.addEventListener('click', () => confirm.remove());
      yes.addEventListener('click', () => {
        void this.store.clear().then(() => this.refresh());
        confirm.remove();
      });
      confirm.append(text, no, yes);
      bar.append(confirm);
    });
  }
}
