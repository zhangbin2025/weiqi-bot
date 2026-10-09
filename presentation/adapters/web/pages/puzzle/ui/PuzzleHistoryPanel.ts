/**
 * 做题历史面板
 * @description 加载、渲染、清除做题历史（复用 ActivityLogService）
 */
import type { PuzzleApp, PuzzleHistoryEntry } from '../../../../../../application/puzzle/PuzzleApp';
import { PUZZLE_SOURCE_LABELS } from '../../../../../../application/puzzle/PuzzleApp';
import { Dialog } from '@ui';

/** 历史面板配置 */
export interface PuzzleHistoryPanelConfig {
  puzzleApp: PuzzleApp;
}

/** 做题历史面板 */
export class PuzzleHistoryPanel {
  private history: PuzzleHistoryEntry[] = [];
  private page = 0;
  private readonly PER_PAGE = 12;

  constructor(private config: PuzzleHistoryPanelConfig) {}

  /** 加载历史 */
  async loadHistory(): Promise<void> {
    try {
      this.history = await this.config.puzzleApp.queryHistory({ limit: 200 });
    } catch (e) {
      console.error('[PuzzleHistoryPanel] 加载历史失败', e);
      this.history = [];
    }
  }

  /** 渲染历史面板 */
  render(onChange: () => void): void {
    const count = this.history.length;
    const countEl = document.getElementById('history-count');
    if (countEl) countEl.textContent = `已完成 ${count} 题`;
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

    const totalPages = Math.max(1, Math.ceil(count / this.PER_PAGE));
    this.page = Math.min(this.page, totalPages - 1);
    const items = this.history.slice(this.page * this.PER_PAGE, (this.page + 1) * this.PER_PAGE);

    grid.innerHTML = '';
    for (const entry of items) {
      grid.appendChild(this.buildItem(entry));
    }

    if (pagination) {
      (pagination as HTMLElement).style.display = totalPages > 1 ? 'flex' : 'none';
      const info = document.getElementById('page-info');
      if (info) info.textContent = `${this.page + 1}/${totalPages}`;
      const prev = document.getElementById('prev-page-btn') as HTMLButtonElement | null;
      const next = document.getElementById('next-page-btn') as HTMLButtonElement | null;
      if (prev) prev.disabled = this.page === 0;
      if (next) next.disabled = this.page >= totalPages - 1;
    }
    void onChange;
  }

  /** 构建单个历史条目 */
  private buildItem(entry: PuzzleHistoryEntry): HTMLElement {
    const div = document.createElement('div');
    div.className = 'puzzle-history-item';
    const date = new Date(entry.solvedAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const sourceLabel = PUZZLE_SOURCE_LABELS[entry.source as keyof typeof PUZZLE_SOURCE_LABELS] ?? entry.source ?? '';
    div.innerHTML = `
      <div class="phi-head">
        <span class="phi-result ${entry.success ? 'ok' : 'fail'}">${entry.success ? '✓ 正解' : '✗ 未解出'}</span>
        <span class="phi-date">${dateStr}</span>
      </div>
      <div class="phi-title">${escapeHtml(entry.title || '题目')}</div>
      <div class="phi-meta">
        <span>${escapeHtml(entry.tag || '')}</span>
        <span>${escapeHtml(sourceLabel)}</span>
        <span>${entry.moves} 手</span>
        <span>${(entry.duration / 1000).toFixed(1)}s</span>
      </div>
    `;
    return div;
  }

  /** 上一页 */
  prevPage(render: () => void): void {
    if (this.page > 0) { this.page--; render(); }
  }

  /** 下一页 */
  nextPage(render: () => void): void {
    this.page++;
    render();
  }

  /** 清空历史 */
  async clearHistory(render: () => void): Promise<void> {
    if (!(await Dialog.confirm('确定清空所有做题历史？'))) return;
    await this.config.puzzleApp.clearHistory();
    this.history = [];
    this.page = 0;
    render();
    await Dialog.alert('做题历史已清除');
  }

  /** 导出历史 */
  async exportHistory(): Promise<void> {
    const json = await this.config.puzzleApp.exportHistory();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `puzzle-history-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/** HTML 转义 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}
