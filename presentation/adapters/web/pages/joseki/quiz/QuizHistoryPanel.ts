/**
 * 定式挑战历史面板
 * @description 处理历史面板的加载、渲染、导出、清除
 */
import type { JosekiQuizApp, QuizHistoryEntry } from '../../../../../../application/joseki';
import { createJosekiThumbnail } from '../../../components/JosekiThumbnail';
import { Dialog } from '@ui';
/** 历史面板配置 */
export interface QuizHistoryPanelConfig {
  quizApp: JosekiQuizApp;
}
/**
 * 历史面板控制器
 */
export class QuizHistoryPanel {
  private history: QuizHistoryEntry[] = [];
  private historyPage: number = 0;
  private readonly HISTORY_PER_PAGE = 12;
  constructor(private config: QuizHistoryPanelConfig) {}
  /** 加载历史 */
  async loadHistory(): Promise<void> {
    try {
      this.history = await this.config.quizApp.queryHistory({ limit: 50 });
    } catch (error) {
      console.error('加载历史失败', error as Error);
    }
  }
  /** 渲染历史面板 */
  renderHistoryPanel(onItemClick: (entry: QuizHistoryEntry) => void): void {
    const count = this.history.length;
    const countEl = document.getElementById('history-count');
    if (countEl) countEl.textContent = `已完成 ${count} 个`;
    const grid = document.getElementById('history-grid');
    const empty = document.getElementById('history-empty');
    const pagination = document.getElementById('history-pagination');
    if (!grid) return;
    if (count === 0) {
      grid.innerHTML = '';
      if (empty) (empty as HTMLElement).style.display = 'block';
      if (pagination) (pagination as HTMLElement).style.display = 'none';
      return;
    }
    if (empty) (empty as HTMLElement).style.display = 'none';
    // 分页
    const totalPages = Math.ceil(count / this.HISTORY_PER_PAGE);
    this.historyPage = Math.min(this.historyPage, totalPages - 1);
    const start = this.historyPage * this.HISTORY_PER_PAGE;
    const items = this.history.slice(start, start + this.HISTORY_PER_PAGE);
    grid.innerHTML = '';
    items.forEach((entry) => {
      const div = document.createElement('div');
      div.className = 'joseki-item';
      // 解析着法
      const moves = this.parsePath(entry.path);
      const canvas = createJosekiThumbnail(moves, 80);
      const info = document.createElement('div');
      info.className = 'item-info';
      info.innerHTML = `
        <div class="item-moves">${moves.length}手</div>
        <div>${entry.color === 'black' ? '执黑' : '执白'}</div>
      `;
      div.appendChild(canvas);
      div.appendChild(info);
      // 点击回调
      div.addEventListener('click', () => onItemClick(entry));
      grid.appendChild(div);
    });
    if (totalPages > 1 && pagination) {
      (pagination as HTMLElement).style.display = 'flex';
      (document.getElementById('page-info') as HTMLElement).textContent = `${this.historyPage + 1}/${totalPages}`;
      (document.getElementById('prev-page-btn') as HTMLButtonElement).disabled = this.historyPage === 0;
      (document.getElementById('next-page-btn') as HTMLButtonElement).disabled = this.historyPage >= totalPages - 1;
    } else if (pagination) {
      (pagination as HTMLElement).style.display = 'none';
    }
  }
  /** 导出历史 */
  exportHistory(): void {
    const data = JSON.stringify(this.history, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `joseki-quiz-history-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    void Dialog.alert('导出成功');
  }
  /** 清空历史 */
  async clearHistory(): Promise<void> {
    if (!(await Dialog.confirm('确定清空所有历史记录？'))) return;
    await this.config.quizApp.clearHistory();
    this.history = [];
    this.renderHistoryPanel(() => {});
    await Dialog.alert('历史记录已清除');
  }
  /** 上一页 */
  prevPage(renderCallback: () => void): void {
    if (this.historyPage > 0) {
      this.historyPage--;
      renderCallback();
    }
  }
  /** 下一页 */
  nextPage(renderCallback: () => void): void {
    this.historyPage++;
    renderCallback();
  }
  /** 解析路径 */
  private parsePath(path: string[]): Array<{ x: number; y: number; color: 'black' | 'white'; isPass: boolean }> {
    return path.map((coord, i) => {
      const isPass = coord === 'tt';
      return {
        x: isPass ? -1 : coord.charCodeAt(0) - 97,
        y: isPass ? -1 : coord.charCodeAt(1) - 97,
        color: i % 2 === 0 ? 'black' as const : 'white' as const,
        isPass,
      };
    });
  }
  /** 获取历史列表 */
  getHistory(): QuizHistoryEntry[] {
    return this.history;
  }
  /** 重置 */
  reset(): void {
    this.history = [];
    this.historyPage = 0;
  }
}
