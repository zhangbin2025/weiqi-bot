/**
 * 定式挑战 UI 辅助工具
 * @description 处理 UI 更新、格式化、弹窗显示等
 */
/** 胜率统计 */
export interface WinrateStats {
  delta: number;
  stddev?: number;
  samples?: number;
  positive?: number;
  negative?: number;
  neutral?: number;
}
/**
 * UI 辅助工具
 */
export class QuizUIHelper {
  /** 更新模式标记 */
  updateModeBadge(mode: 'explore' | 'challenge'): void {
    const badge = document.getElementById('mode-badge');
    if (!badge) return;
    badge.textContent = mode === 'explore' ? '探索' : '挑战';
    badge.className = `mode-badge ${mode}`;
  }
  /** 更新进度 */
  updateProgress(current: number, total: number): void {
    const percent = total > 0 ? (current / total * 100) : 0;
    const bar = document.getElementById('progress-bar') as HTMLElement;
    if (bar) bar.style.width = `${percent}%`;
  }
  /** 显示脱先提示 */
  showPassOverlay(text: string): void {
    const overlay = document.getElementById('pass-overlay');
    if (!overlay) return;
    overlay.textContent = text;
    (overlay as HTMLElement).style.display = 'block';
    setTimeout(() => {
      (overlay as HTMLElement).style.display = 'none';
    }, 800);
  }
  /** 显示胜率详情弹窗 */
  showWinrateDetail(winrate: WinrateStats | undefined): void {
    if (!winrate) return;
    const stats = winrate;
    const delta = stats.delta;
    // 构建内容
    let html = '<div class="winrate-detail-row"><span class="winrate-detail-label">胜率变化</span><span class="winrate-detail-value">' + (delta > 0 ? '+' : '') + (delta * 100).toFixed(2) + '%</span></div>';
    if (stats.stddev !== undefined) {
      const stddev = stats.stddev;
      let stability = '较稳定';
      if (stddev < 0.02) stability = '很稳定';
      else if (stddev < 0.04) stability = '较稳定';
      else if (stddev < 0.06) stability = '一般';
      else stability = '不稳定';
      html += '<div class="winrate-detail-row"><span class="winrate-detail-label">标准差</span><span class="winrate-detail-value">' + stddev.toFixed(4) + ' (' + stability + ')</span></div>';
    }
    if (stats.samples !== undefined) {
      const samples = stats.samples;
      const positive = stats.positive || 0;
      const negative = stats.negative || 0;
      const neutral = stats.neutral || 0;
      const posPct = samples > 0 ? Math.round(positive / samples * 100) : 0;
      const negPct = samples > 0 ? Math.round(negative / samples * 100) : 0;
      const neuPct = samples > 0 ? Math.round(neutral / samples * 100) : 0;
      html += '<div class="winrate-detail-row"><span class="winrate-detail-label">样本数</span><span class="winrate-detail-value">' + samples + '</span></div>';
      html += '<div class="winrate-bar"><div class="winrate-bar-positive" style="width:' + posPct + '%"></div><div class="winrate-bar-neutral" style="width:' + neuPct + '%"></div><div class="winrate-bar-negative" style="width:' + negPct + '%"></div></div>';
      html += '<div class="winrate-bar-labels"><span>黑有利 ' + positive + ' (' + posPct + '%)</span><span>中性 ' + neutral + '</span><span>白有利 ' + negative + ' (' + negPct + '%)</span></div>';
    }
    html += '<div class="winrate-hint">💡 delta > 0: 先手有利</div>';
    // 更新弹窗内容
    const content = document.getElementById('winrate-content');
    if (content) {
      content.innerHTML = html;
    }
    // 显示弹窗
    const backdrop = document.getElementById('winrate-backdrop');
    const sheet = document.getElementById('winrate-sheet');
    if (backdrop) backdrop.classList.add('active');
    if (sheet) sheet.classList.add('active');
  }
  /** 隐藏胜率详情弹窗 */
  hideWinrateDetail(): void {
    const backdrop = document.getElementById('winrate-backdrop');
    const sheet = document.getElementById('winrate-sheet');
    if (backdrop) backdrop.classList.remove('active');
    if (sheet) sheet.classList.remove('active');
  }
  /** 隐藏弹窗 */
  hideModal(id: string): void {
    document.getElementById(id)?.classList.remove('show');
  }
  /** 格式化频率 */
  formatFreq(freq: number): string {
    if (freq >= 1000) return `${(freq / 1000).toFixed(1)}k`;
    return String(freq);
  }
  /** 格式化概率 */
  formatProb(prob: number): string {
    if (prob < 0.0001) return '<0.01%';
    return `${(prob * 100).toFixed(2)}%`;
  }
}
