/**
 * 抓包渲染器
 * @module presentation/adapters/web/pages/debug/renderers/SnifferRenderer
 */
/**
 * 抓包渲染器
 */
export class SnifferRenderer {
  /**
   * 渲染抓包会话
   */
  render(sessions: string[]): string {
    return `
      <div class="glass-card" style="padding: 12px;">
        <h3 style="margin-bottom: 12px;">运行中的抓包会话</h3>
        ${this.renderSessionList(sessions)}
      </div>
    `;
  }
  /**
   * 渲染会话列表
   */
  private renderSessionList(sessions: string[]): string {
    if (sessions.length === 0) {
      return '<div style="color: #888;">暂无运行中的会话</div>';
    }
    return sessions.map(session => `
      <div style="padding: 8px; margin-bottom: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">
        ${session}
      </div>
    `).join('');
  }
}
