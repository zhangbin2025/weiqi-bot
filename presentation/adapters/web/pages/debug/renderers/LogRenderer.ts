/**
 * 日志渲染器
 * @module presentation/adapters/web/pages/debug/renderers/LogRenderer
 */
import type { LogEntry, LogStats } from '@services/debug/types';
import { formatTime, getLevelColor, escapeHtml } from '../utils/format';
/**
 * 日志渲染器
 */
export class LogRenderer {
  /**
   * 渲染日志
   */
  render(logs: LogEntry[], stats: LogStats): string {
    return `
      <div class="glass-card" style="padding: 12px;">
        <div style="margin-bottom: 12px;">
          <strong>日志统计：</strong>
          总计 ${stats.total} 条 |
          <span style="color: #f44;">ERROR ${stats.error}</span> |
          <span style="color: #f80;">WARN ${stats.warn}</span> |
          <span style="color: #08f;">INFO ${stats.info}</span> |
          <span style="color: #888;">DEBUG ${stats.debug}</span>
        </div>
        <div style="margin-bottom: 12px;">
          <button class="glass-btn" id="clear-logs">清空日志</button>
        </div>
        <div class="log-list" style="max-height: 400px; overflow-y: auto;">
          ${this.renderLogList(logs)}
        </div>
      </div>
    `;
  }
  /**
   * 渲染日志列表
   */
  private renderLogList(logs: LogEntry[]): string {
    if (logs.length === 0) {
      return '<div style="color: #888; text-align: center; padding: 20px;">暂无日志</div>';
    }
    return logs.map(log => `
      <div class="log-entry ${log.level.toLowerCase()}" style="padding: 8px; margin-bottom: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; font-size: 12px;">
        <div style="display: flex; gap: 8px; margin-bottom: 4px;">
          <span style="color: #aaa;">${formatTime(log.timestamp)}</span>
          <span style="color: ${getLevelColor(log.level)}; font-weight: bold;">${log.level}</span>
          <span style="color: #08f;">[${log.tag}]</span>
        </div>
        <div style="word-break: break-all;">${escapeHtml(log.message)}</div>
      </div>
    `).join('');
  }
}
