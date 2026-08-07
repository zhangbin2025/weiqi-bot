/**
 * 定式列表胜率辅助工具
 * @description 处理胜率详情显示
 */
/** 胜率统计 */
export interface WinrateStats {
  delta?: number;
  stddev?: number;
  samples?: number;
  positive?: number;
  negative?: number;
  neutral?: number;
}
/**
 * 胜率辅助工具
 */
export class JosekiWinrateHelper {
  /** 显示胜率详情弹窗 */
  showWinrateDetail(stats: WinrateStats | undefined): void {
    if (!stats?.delta) {
      return;
    }
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
  /** 格式化胜率显示 */
  formatWinrate(delta: number | undefined): { display: string; className: string } {
    if (delta === undefined) {
      return { display: '-', className: 'neutral' };
    }
    const display = (delta > 0 ? '+' : '') + (delta * 100).toFixed(1) + '%';
    const className = delta > 0.01 ? 'positive' : delta < -0.01 ? 'negative' : 'neutral';
    return { display, className };
  }
}
