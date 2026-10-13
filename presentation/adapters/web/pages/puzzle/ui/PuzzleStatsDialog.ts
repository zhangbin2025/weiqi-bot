/**
 * 做题统计弹框
 * @description 展示常规统计 + 分题型棋力 + 综合棋力评估。
 *              复用 ui.css 的 .dialog-overlay/.dialog 体系（与 PuzzleFilterDialog 一致）。
 */
import type { StrengthReport, TypeStrength, RankEstimate } from '../../../../../../application/puzzle/PuzzleStrengthAnalyzer';

/** 置信度文案 */
const CONFIDENCE_LABEL: Record<RankEstimate['confidence'], string> = {
  high: '可信',
  medium: '一般',
  low: '参考',
};

/** 统计弹框 */
export class PuzzleStatsDialog {
  /**
   * 打开统计弹框
   * @param report - 统计报告（外部已算好）
   */
  static open(report: StrengthReport): void {
    const dialog = document.createElement('div');
    dialog.className = 'puzzle-stats-dialog';
    dialog.innerHTML = (
      '<div class="dialog-overlay show">' +
        '<div class="dialog">' +
          '<div class="dialog-title">做题统计</div>' +
          '<div class="pst-tabs" role="tablist">' +
            '<button type="button" class="pst-tab active" data-tab="strength" role="tab">棋力评估</button>' +
            '<button type="button" class="pst-tab" data-tab="stats" role="tab">做题统计</button>' +
          '</div>' +
          '<div class="puzzle-stats-body">' +
            '<div class="pst-panel" data-panel="strength">' +
              PuzzleStatsDialog.renderOverall(report) +
              PuzzleStatsDialog.renderByType(report) +
            '</div>' +
            '<div class="pst-panel" data-panel="stats" hidden>' +
              PuzzleStatsDialog.renderSummary(report) +
            '</div>' +
          '</div>' +
          '<div class="dialog-btn-group">' +
            '<button class="dialog-btn primary" data-act="close">关闭</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(dialog);

    // 标签切换
    const tabs = dialog.querySelectorAll<HTMLButtonElement>('.pst-tab');
    const panels = dialog.querySelectorAll<HTMLElement>('.pst-panel');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.dataset['tab'];
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        panels.forEach((p) => { p.hidden = p.dataset['panel'] !== name; });
      });
    });

    const close = () => dialog.remove();
    dialog.querySelector('[data-act="close"]')?.addEventListener('click', close);
    const overlayEl = dialog.querySelector('.dialog-overlay');
    overlayEl?.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
  }

  /** 综合棋力区块 */
  private static renderOverall(report: StrengthReport): string {
    const e = report.overall;
    if (!e || !e.described) {
      return (
        '<div class="puzzle-stats-section">' +
          '<div class="puzzle-stats-label">综合棋力</div>' +
          '<div class="puzzle-stats-empty">有效样本不足，继续做题后可评估</div>' +
          '<div class="puzzle-stats-comment">' + escapeHtml(report.comment) + '</div>' +
        '</div>'
      );
    }
    const prefix = e.hitCeiling ? '≥ ' : (e.hitFloor ? '≤ ' : '');
    const rangeText = e.hitCeiling
      ? `已达最高难度 ${e.rank}`
      : (e.hitFloor ? `低于最低难度 ${e.rank}` : `${e.range[0]} ~ ${e.range[1]}`);
    return (
      '<div class="puzzle-stats-section">' +
        '<div class="puzzle-stats-label">综合棋力</div>' +
        '<div class="puzzle-stats-rank">' +
          '<span class="psr-value">' + prefix + escapeHtml(e.rank) + '</span>' +
          '<span class="psr-range">' + escapeHtml(rangeText) + '</span>' +
          '<span class="psr-conf psr-conf-' + e.confidence + '">' + CONFIDENCE_LABEL[e.confidence] + '（' + e.sampleCount + ' 题）</span>' +
        '</div>' +
        '<div class="puzzle-stats-comment">' + escapeHtml(report.comment) + '</div>' +
      '</div>'
    );
  }

  /** 分题型棋力表 */
  private static renderByType(report: StrengthReport): string {
    const rows = report.byType.filter((t: TypeStrength) => t.count > 0);
    if (rows.length === 0) {
      return (
        '<div class="puzzle-stats-section">' +
          '<div class="puzzle-stats-label">分题型棋力</div>' +
          '<div class="puzzle-stats-empty">暂无带难度的做题记录</div>' +
        '</div>'
      );
    }
    const body = rows.map((t: TypeStrength) => {
      const est = t.estimate;
      const rankText = !est || !est.described
        ? '—'
        : ((est.hitCeiling ? '≥ ' : (est.hitFloor ? '≤ ' : '')) + est.rank);
      const cls = est && est.described ? '' : ' psr-na';
      // 有效样本少于题数时（部分题无难度标签或被判为未认真作答）给出提示
      const countText = t.rated < t.count
        ? t.count + ' 题（' + t.rated + ' 有效）'
        : t.count + ' 题';
      return (
        '<div class="pst-row">' +
          '<span class="pst-type">' + escapeHtml(t.type) + '</span>' +
          '<span class="pst-count">' + countText + '</span>' +
          '<span class="pst-rate">' + pct(t.rate) + '</span>' +
          '<span class="pst-rank' + cls + '">' + escapeHtml(rankText) + '</span>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="puzzle-stats-section">' +
        '<div class="puzzle-stats-label">分题型棋力</div>' +
        '<div class="puzzle-stats-table">' +
          '<div class="pst-row pst-head">' +
            '<span class="pst-type">题型</span>' +
            '<span class="pst-count">题数</span>' +
            '<span class="pst-rate">正确率</span>' +
            '<span class="pst-rank">棋力</span>' +
          '</div>' +
          body +
        '</div>' +
      '</div>'
    );
  }

  /** 常规统计区块 */
  private static renderSummary(report: StrengthReport): string {
    const s = report.summary;
    const dist = report.typeDistribution
      .map((d) => (
        '<span class="psd-chip">' + escapeHtml(d.label) + ' ' + d.count + '</span>'
      )).join('');
    const diff = report.difficultyDistribution
      .map((d) => (
        '<span class="psd-chip">' + escapeHtml(d.label) + ' ' + d.count + '（' + pct(d.rate) + '）</span>'
      )).join('');
    return (
      '<div class="puzzle-stats-section">' +
        '<div class="puzzle-stats-label">常规统计</div>' +
        '<div class="pss-grid">' +
          kv('总题数', `${s.total} 题`) +
          kv('已解出', `${s.success} 题`) +
          kv('未解出', `${s.failed} 题`) +
          kv('总正确率', pct(s.rate)) +
          kv('今日 / 本周', `${s.today} / ${s.thisWeek} 题`) +
          kv('近 30 天', `${s.thisMonth} 题`) +
          kv('平均耗时', formatDuration(s.avgDuration)) +
          kv('评估样本', `${s.rated} 题（排除 ${s.unrated}）`) +
        '</div>' +
        '<div class="psd-block">' +
          '<div class="psd-title">题型分布</div>' +
          '<div class="psd-chips">' + (dist || '<span class="psd-chip">—</span>') + '</div>' +
        '</div>' +
        '<div class="psd-block">' +
          '<div class="psd-title">难度分布</div>' +
          '<div class="psd-chips">' + (diff || '<span class="psd-chip">—</span>') + '</div>' +
        '</div>' +
      '</div>'
    );
  }
}

/** 百分比（0~1 → xx%） */
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** 毫秒 → 可读时长 */
function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return rest > 0 ? `${min} 分 ${rest} 秒` : `${min} 分`;
}

/** key-value 行 */
function kv(label: string, value: string): string {
  return (
    '<div class="pss-item">' +
      '<span class="pss-k">' + escapeHtml(label) + '</span>' +
      '<span class="pss-v">' + escapeHtml(value) + '</span>' +
    '</div>'
  );
}

/** HTML 转义 */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
