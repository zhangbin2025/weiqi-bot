/**
 * 定式发现 UI 辅助工具
 * @description 处理进度显示、统计显示、格式化
 */
import type { DiscoverResult } from '../../../../../../application/joseki';
/**
 * UI 辅助工具
 */
export class DiscoverUIHelper {
  /** 显示进度 */
  showProgress(show: boolean): void {
    const card = document.getElementById('progress-card');
    if (card) (card as HTMLElement).style.display = show ? 'block' : 'none';
  }
  /** 更新进度 */
  updateProgress(percent: number, text: string): void {
    const bar = document.getElementById('progress-bar');
    const textEl = document.getElementById('progress-text');
    if (bar) (bar as HTMLElement).style.width = `${percent}%`;
    if (textEl) (textEl as HTMLElement).textContent = text;
  }
  /** 显示统计 */
  displayStats(result: DiscoverResult | undefined): void {
    if (!result) return;
    let hotCount = 0;
    let hitCount = 0;
    let complexCount = 0;
    result.patterns.forEach(p => {
      if (p.prefixLen >= 8 && p.frequency >= 5) hotCount++;
      if (p.prefixLen >= 8 && p.prefixLen >= p.totalMoves) hitCount++;
      if (p.prefixLen >= 12) complexCount++;
    });
    const josekiEl = document.getElementById('stat-joseki');
    const hotEl = document.getElementById('stat-hot');
    const hitEl = document.getElementById('stat-hit');
    const complexEl = document.getElementById('stat-complex');
    if (josekiEl) josekiEl.textContent = String(result.totalPatterns || 0);
    if (hotEl) hotEl.textContent = String(hotCount);
    if (hitEl) hitEl.textContent = String(hitCount);
    if (complexEl) complexEl.textContent = String(complexCount);
  }
  /** 隐藏所有标签 */
  hideAllTabs(): void {
    const onlineTab = document.getElementById('online-tab');
    const uploadTab = document.getElementById('upload-tab');
    const historyTab = document.getElementById('history-tab');
    if (onlineTab) onlineTab.style.display = 'none';
    if (uploadTab) uploadTab.style.display = 'none';
    if (historyTab) historyTab.style.display = 'none';
  }
  /** 显示统计区域 */
  showStatsSection(show: boolean): void {
    const section = document.getElementById('stats-section');
    if (section) section.style.display = show ? 'block' : 'none';
  }
  /** 格式化日期 */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  /** 获取日期字符串 */
  getDateStr(offset: number): string {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return date.toISOString().slice(0, 10);
  }
}
