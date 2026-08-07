/**
 * 胜率详情渲染器
 * @module presentation/pages/common/WinrateDetailRenderer
 */
import type { ICard } from '../../../../core/interfaces';
/** 胜率统计接口 */
export interface WinrateStats {
  delta: number;
  stddev?: number;
  samples?: number;
  positive?: number;
  negative?: number;
  neutral?: number;
}
/** 渲染胜率详情 */
export function renderWinrateDetail(card: ICard, stats: WinrateStats): void {
  const { delta, stddev, samples } = stats;
  // 胜率条
  const positiveWidth = Math.max(0, Math.min(100, 50 + delta * 500));
  const negativeWidth = 100 - positiveWidth;
  const lines = [
    '📊 胜率详情',
    '',
    `胜率变化: ${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`,
    stddev ? `标准差: ±${(stddev * 100).toFixed(1)}%` : '',
    samples ? `样本数: ${samples}` : '',
    '',
    '━━━━━━━━━━',
    `胜: ${positiveWidth.toFixed(0)}%`,
    `负: ${negativeWidth.toFixed(0)}%`,
  ].filter(Boolean);
  card.setContent(lines.join('\n'));
  card.render();
}
/** 格式化胜率内容为字符串 */
export function formatWinrateContent(stats: WinrateStats): string {
  const positiveWidth = Math.max(0, Math.min(100, 50 + stats.delta * 500));
  return [
    `胜率变化: ${stats.delta > 0 ? '+' : ''}${(stats.delta * 100).toFixed(1)}%`,
    stats.stddev ? `标准差: ±${(stats.stddev * 100).toFixed(1)}%` : '',
    stats.samples ? `样本数: ${stats.samples}` : '',
    '',
    `胜: ${positiveWidth.toFixed(0)}% | 负: ${(100 - positiveWidth).toFixed(0)}%`,
  ]
    .filter(Boolean)
    .join('\n');
}
