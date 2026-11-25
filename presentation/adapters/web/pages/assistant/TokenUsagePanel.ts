/**
 * Token 消耗面板（AI 对话页右上角菜单第 7 项）
 * @module presentation/adapters/web/pages/assistant/TokenUsagePanel
 *
 * 界面刻意保持简单：一个弹窗、一条时间段切换条、主要就是消耗数据。
 * - 总览：合计 / 上行 / 下行 / 请求数（未上报用量单列提示）
 * - 「按提供商 / 模型」一张表（provider › model 二级展开为一行一个模型）
 * - 「按用途」一行简要（task 维度用得上但不占版面）
 * - 趋势：按天堆叠柱，高度线性归一化到窗口内最大值，无平滑无估算
 * - 底部：保留天数、实测存储占用、清空（内联二次确认，不嵌套单例 WebDialog）
 *
 * 所有动态文本（provider host / 模型名 / task）一律 escapeHtml 后再进 innerHTML。
 */

import type { WebDialog } from '../../components/Dialog';
import type { TokenUsageStore } from '../../../../../infrastructure/token/TokenUsageStore';
import {
  TOKEN_RANGE_LABELS, MIN_TOKEN_RETENTION_DAYS, MAX_TOKEN_RETENTION_DAYS,
  type TokenRangeId, type TokenStats,
} from '../../../../../application/token/TokenUsageTypes';
import {
  computeTokenStats, formatTokenCount, formatBytes, rangeBounds,
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
        + '<div class="tk-footer" id="tkFooter"></div>'
        + '</div>',
      buttons: [{ id: 'close', text: '关闭' }],
    });
    this.bindRanges();
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
    const footer = document.getElementById('tkFooter');
    if (!body || !footer) return;
    const now = Date.now();
    const retention = loadTokenRetentionDays();
    // 一次读够最宽窗口（最近 30 天），切时间段只重算不重读。
    const widest = rangeBounds('last30', now);
    let stats: TokenStats;
    let bytes: number;
    try {
      const records = await this.store.loadRangeAndPrune(
        widest.fromDate, widest.toDate, retention, now,
      );
      bytes = await this.store.storageBytes();
      stats = computeTokenStats(records, this.range, now);
    } catch {
      if (seq !== this.seq) return;
      body.innerHTML = '<div class="tk-empty">统计读取失败，请稍后重试。</div>';
      footer.textContent = '';
      return;
    }
    if (seq !== this.seq) return;
    body.innerHTML = this.renderStats(stats);
    footer.innerHTML = this.renderFooter(retention, bytes);
    this.bindClear();
  }

  private renderStats(s: TokenStats): string {
    const t = s.total;
    const unreported = t.unreported > 0
      ? `<div class="tk-note">⚠️ ${t.unreported} 次请求端点未上报 usage，token 记为 0，未计入下方合计。</div>`
      : '';
    return [
      `<div class="tk-summary">`,
      `<div class="tk-summary__main"><span>总消耗</span><strong>${formatTokenCount(t.totalTokens)}</strong><span>tokens</span></div>`,
      `<div class="tk-summary__sub">上行 ${formatTokenCount(t.promptTokens)} · 下行 ${formatTokenCount(t.completionTokens)} · ${t.requests} 次请求</div>`,
      `</div>`,
      unreported,
      `<div class="tk-section-title">按提供商 / 模型</div>`,
      this.renderModelTable(s),
      `<div class="tk-section-title">按用途</div>`,
      this.renderTaskLine(s),
      `<div class="tk-section-title">消耗趋势（${escapeHtml(s.fromDate)} ~ ${escapeHtml(s.toDate)}）</div>`,
      this.renderTrend(s),
    ].join('');
  }

  private renderModelTable(s: TokenStats): string {
    if (s.byModel.length === 0) return '<div class="tk-empty">该时间段暂无请求</div>';
    const rows = s.byModel.map((r) => {
      const [provider, model] = r.key.split(MODEL_KEY_SEP);
      return `<tr>`
        + `<td>${escapeHtml(provider ?? '')}</td>`
        + `<td>${escapeHtml(model ?? '')}</td>`
        + `<td class="tk-num">${r.requests}</td>`
        + `<td class="tk-num">${formatTokenCount(r.promptTokens)}</td>`
        + `<td class="tk-num">${formatTokenCount(r.completionTokens)}</td>`
        + `<td class="tk-num tk-num--strong">${formatTokenCount(r.totalTokens)}</td>`
        + `</tr>`;
    }).join('');
    return `<table class="tk-table"><thead><tr>`
      + '<th>提供商</th><th>模型</th><th>次数</th><th>上行</th><th>下行</th><th>合计</th>'
      + `</tr></thead><tbody>${rows}</tbody></table>`;
  }

  private renderTaskLine(s: TokenStats): string {
    if (s.byTask.length === 0) return '<div class="tk-empty">—</div>';
    return `<div class="tk-tasks">${s.byTask.map((r) =>
      `<span class="tk-task">${escapeHtml(TASK_LABELS[r.key] ?? r.key)} ${formatTokenCount(r.totalTokens)}</span>`,
    ).join('')}</div>`;
  }

  private renderTrend(s: TokenStats): string {
    // 高度按窗口内最大单日合计线性归一化；max=0 时全为 0 高，不做任何估算。
    const max = s.trend.reduce((m, d) => Math.max(m, d.totalTokens), 0);
    const cols = s.trend.map((d) => {
      const pHeight = max > 0 ? (d.promptTokens / max) * 100 : 0;
      const cHeight = max > 0 ? (d.completionTokens / max) * 100 : 0;
      const label = d.date.slice(5); // MM-DD
      return `<div class="tk-col" title="${escapeHtml(d.date)}：合计 ${formatTokenCount(d.totalTokens)}（上行 ${formatTokenCount(d.promptTokens)} / 下行 ${formatTokenCount(d.completionTokens)}）">`
        + `<div class="tk-bar-wrap">`
        + `<div class="tk-bar tk-bar--completion" style="height:${cHeight.toFixed(2)}%"></div>`
        + `<div class="tk-bar tk-bar--prompt" style="height:${pHeight.toFixed(2)}%"></div>`
        + `</div><div class="tk-col__label">${escapeHtml(label)}</div></div>`;
    }).join('');
    return `<div class="tk-trend">${cols}</div>`
      + '<div class="tk-legend"><span class="tk-legend__in">■ 上行</span><span class="tk-legend__out">■ 下行</span>'
      + (max > 0 ? `<span>峰值 ${formatTokenCount(max)} / 日</span>` : '') + '</div>';
  }

  private renderFooter(retention: number, bytes: number): string {
    return `<div class="tk-footer__line">保留 ${retention} 天（/llm retention ${MIN_TOKEN_RETENTION_DAYS}~${MAX_TOKEN_RETENTION_DAYS} 可改） · 存储占用 ${formatBytes(bytes)}</div>`
      + `<div class="tk-footer__line"><button type="button" class="tk-clear" id="tkClear">清空全部统计</button></div>`;
  }

  private bindClear(): void {
    const btn = document.getElementById('tkClear');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // 内联二次确认：不嵌套单例 WebDialog、不依赖 window.confirm
      const footer = document.getElementById('tkFooter');
      if (!footer || footer.querySelector('.tk-confirm')) return;
      const bar = document.createElement('div');
      bar.className = 'tk-confirm';
      const text = document.createElement('span');
      text.textContent = '确定清空全部 Token 统计？此操作不可恢复。';
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.textContent = '确定清空';
      const no = document.createElement('button');
      no.type = 'button';
      no.textContent = '取消';
      no.addEventListener('click', () => bar.remove());
      yes.addEventListener('click', () => {
        void this.store.clear().then(() => this.refresh());
        bar.remove();
      });
      bar.append(text, no, yes);
      footer.append(bar);
    });
  }
}
