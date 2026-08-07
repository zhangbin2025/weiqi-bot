/**
 * 定式探索 UI 辅助工具
 * @description 处理统计更新、格式化、弹窗显示
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
/** 统计数据 */
export interface ExploreStats {
  moves: number;
  freq?: number;
  prob?: number;
  winrate?: WinrateStats;
}
/**
 * UI 辅助工具
 */
export class ExploreUIHelper {
  private currentWinrate: WinrateStats | undefined;
  /** 更新统计显示 */
  updateStats(stats: ExploreStats): void {
    const movesEl = document.getElementById('stat-moves');
    const freqEl = document.getElementById('stat-freq');
    const probEl = document.getElementById('stat-prob');
    const winrateEl = document.getElementById('stat-winrate');
    if (movesEl) movesEl.textContent = String(stats.moves);
    if (freqEl) freqEl.textContent = stats.freq ? this.formatFreq(stats.freq) : '-';
    if (probEl) probEl.textContent = stats.prob ? this.formatProb(stats.prob) : '-';
    if (winrateEl) {
      if (stats.winrate) {
        const delta = stats.winrate.delta;
        winrateEl.textContent = (delta > 0 ? '+' : '') + (delta * 100).toFixed(1) + '%';
        winrateEl.className = 'stat-value clickable ' + (delta > 0.02 ? 'positive' : delta < -0.02 ? 'negative' : 'neutral');
        this.currentWinrate = stats.winrate;
      } else {
        winrateEl.textContent = '-';
        winrateEl.className = 'stat-value';
        this.currentWinrate = undefined;
      }
    }
  }
  /** 格式化频率 */
  formatFreq(freq: number): string {
    if (freq >= 1000000) return (freq / 1000000).toFixed(1) + 'M';
    if (freq >= 1000) return (freq / 1000).toFixed(1) + 'K';
    return String(freq);
  }
  /** 格式化概率 */
  formatProb(prob: number): string {
    return (prob * 100).toFixed(1) + '%';
  }
  /** 显示脱先 overlay */
  showPassOverlay(text: string): void {
    const overlay = document.getElementById('pass-overlay');
    if (!overlay) return;
    overlay.textContent = text;
    overlay.style.display = 'block';
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 800);
  }
  /** 检查并显示脱先提示（首次） */
  checkPassHint(getPassMarkPosition: () => { x: number; y: number } | null): void {
    const passMark = getPassMarkPosition();
    if (!passMark) return;
    if (localStorage.getItem('joseki_pass_hinted')) return;
    localStorage.setItem('joseki_pass_hinted', 'true');
    const hint = document.getElementById('pass-hint');
    if (!hint) return;
    hint.style.position = 'fixed';
    hint.style.left = `${passMark.x - 6}px`;
    hint.style.top = `${passMark.y - 38}px`;
    hint.style.display = 'block';
    setTimeout(() => {
      hint.style.display = 'none';
    }, 3000);
  }
  /** 显示胜率详情弹窗 */
  showWinrateDetail(): void {
    if (!this.currentWinrate) return;
    const stats = this.currentWinrate;
    const delta = stats.delta;
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
    const content = document.getElementById('winrate-content');
    if (content) {
      content.innerHTML = html;
    }
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
}
