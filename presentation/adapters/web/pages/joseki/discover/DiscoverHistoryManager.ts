/**
 * 定式发现历史管理器
 * @description 处理历史记录的加载、渲染、清除
 */
import type { JosekiDiscoverApp, DiscoverHistoryEntry, DiscoverResult } from '../../../../../../application/joseki';
/** 历史记录管理器配置 */
export interface DiscoverHistoryManagerConfig {
  discoverApp: JosekiDiscoverApp;
  onLoadResult: (result: DiscoverResult, source: string) => void;
  formatDate: (timestamp: number) => string;
}
/**
 * 历史记录管理器
 */
export class DiscoverHistoryManager {
  private history: DiscoverHistoryEntry[] = [];
  constructor(private config: DiscoverHistoryManagerConfig) {}
  /** 加载历史记录 */
  async loadHistory(): Promise<void> {
    try {
      this.history = await this.config.discoverApp.queryHistory({ limit: 20 });
      this.renderHistoryList();
    } catch (error) {
      // 忽略错误
    }
  }
  /** 渲染历史列表 */
  renderHistoryList(): void {
    const container = document.getElementById('history-list');
    if (!container) return;
    if (this.history.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div>暂无历史记录</div>
        </div>
      `;
      return;
    }
    container.innerHTML = this.history.map(record => {
      const sourceIcon = record.source === 'foxwq' ? '🌐' : '📁';
      const sourceText = record.source === 'foxwq' ? '线上棋谱' : '导入棋谱';
      return `
        <div class="history-item" data-key="${record.key}">
          <div class="history-header">
            <span class="history-id">${sourceIcon} ${sourceText}</span>
            <span class="history-time">${this.config.formatDate(record.discoveredAt)}</span>
          </div>
          <div class="history-stats">
            <span class="history-stat">📋 ${record.gamesCount || 0} 个棋谱</span>
            <span class="history-stat">📚 ${record.patternsFound} 个定式</span>
          </div>
        </div>
      `;
    }).join('');
    container.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const key = (item as HTMLElement).dataset['key'];
        if (key) this.loadHistoryResult(key);
      });
    });
  }
  /** 加载历史结果 */
  private loadHistoryResult(key: string): void {
    const record = this.history.find(r => r.key === key);
    if (!record) return;
    const result: DiscoverResult = {
      patterns: record.patterns || [],
      games: record.games || [],
      gamesCount: record.gamesCount || 0,
      totalPatterns: record.patternsFound,
      category: record.category,
      key: record.key,
    };
    this.config.onLoadResult(result, record.source);
  }
  /** 清除历史 */
  async clearHistory(): Promise<void> {
    try {
      await this.config.discoverApp.clearHistory();
    } catch (error) {
      // 忽略错误
    }
    this.history = [];
    this.renderHistoryList();
  }
  /** 获取历史列表 */
  getHistory(): DiscoverHistoryEntry[] {
    return this.history;
  }
}
