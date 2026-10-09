/**
 * 做题历史面板
 * @description 加载、渲染、清除做题历史（复用 ActivityLogService）。
 *              列表为「滚动到底自动追加 10 条」的懒加载模式（对齐 fetcher 最新棋谱），
 *              每条含初始局面缩略图，点击条目以单题模式打开该题。
 */
import type { PuzzleApp, PuzzleHistoryEntry } from '../../../../../../application/puzzle/PuzzleApp';
import { PUZZLE_SOURCE_LABELS } from '../../../../../../application/puzzle/PuzzleApp';
import { BoardRenderer } from '../../../components/BoardRenderer';
import { BoardStyles } from '../../../components/Board.styles';
import { Dialog } from '@ui';

/** 历史面板配置 */
export interface PuzzleHistoryPanelConfig {
  puzzleApp: PuzzleApp;
  /** 点击条目回调：以单题模式打开该题 */
  onOpenPuzzle: (entry: PuzzleHistoryEntry) => void;
}

/** 做题历史面板 */
export class PuzzleHistoryPanel {
  private history: PuzzleHistoryEntry[] = [];
  /** 当前已展示条数（滚动追加） */
  private displayed = 0;
  private io: IntersectionObserver | null = null;
  private sentinel: HTMLElement | null = null;
  /** 追加锁，避免 observer 在视口未填满时连发 */
  private loadingMore = false;

  /** 初始展示条数 */
  static readonly PAGE_INIT = 10;
  /** 每次追加条数 */
  static readonly PAGE_STEP = 10;

  constructor(private config: PuzzleHistoryPanelConfig) {}

  /** 加载历史（重置浏览位置） */
  async loadHistory(): Promise<void> {
    try {
      this.history = await this.config.puzzleApp.queryHistory({ limit: 500 });
    } catch (e) {
      console.error('[PuzzleHistoryPanel] 加载历史失败', e);
      this.history = [];
    }
    this.reset();
  }

  /** 重置浏览位置 */
  reset(): void {
    this.io?.disconnect();
    this.io = null;
    this.sentinel = null;
    this.displayed = 0;
    this.loadingMore = false;
  }

  /** 渲染历史面板 */
  render(): void {
    const count = this.history.length;
    const countEl = document.getElementById('history-count');
    if (countEl) countEl.textContent = `已做 ${count} 题`;
    const grid = document.getElementById('history-grid');
    const empty = document.getElementById('history-empty');
    if (!grid) return;

    this.io?.disconnect();
    this.io = null;

    if (count === 0) {
      grid.innerHTML = '';
      if (empty) (empty as HTMLElement).style.display = 'block';
      return;
    }
    if (empty) (empty as HTMLElement).style.display = 'none';

    // 首次渲染只展示前 PAGE_INIT 条；已展示过则保持当前浏览位置
    if (this.displayed === 0) this.displayed = Math.min(PuzzleHistoryPanel.PAGE_INIT, count);
    this.displayed = Math.min(this.displayed, count);

    grid.innerHTML = '';
    for (const entry of this.history.slice(0, this.displayed)) {
      grid.appendChild(this.buildItem(entry));
    }

    this.loadingMore = false;
    this.attachSentinel(grid);
  }

  /** 构建单个历史条目（缩略图 + 元信息，点击整条打开该题） */
  private buildItem(entry: PuzzleHistoryEntry): HTMLElement {
    const div = document.createElement('div');
    div.className = 'puzzle-history-item';
    div.setAttribute('role', 'button');
    div.tabIndex = 0;
    div.title = '点击做这一题';

    const size = entry.boardSize || 19;
    div.appendChild(this.buildThumbnail(entry, size));

    const body = document.createElement('div');
    body.className = 'phi-body';

    const title = document.createElement('div');
    title.className = 'phi-title';
    title.textContent = entry.title || '题目';
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'phi-meta';
    const sourceLabel = PUZZLE_SOURCE_LABELS[entry.source as keyof typeof PUZZLE_SOURCE_LABELS] ?? entry.source ?? '';
    const date = new Date(entry.solvedAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    for (const t of [entry.tag, sourceLabel, `${size}路`, dateStr]) {
      if (!t) continue;
      const span = document.createElement('span');
      span.textContent = t;
      meta.appendChild(span);
    }
    body.appendChild(meta);
    div.appendChild(body);

    const open = (): void => this.config.onOpenPuzzle(entry);
    div.addEventListener('click', open);
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    return div;
  }

  /** 构建初始局面缩略图 */
  private buildThumbnail(entry: PuzzleHistoryEntry, size: number): HTMLElement {
    const box = document.createElement('div');
    box.className = 'phi-thumb';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('width', '72');
    canvas.setAttribute('height', '72');
    box.appendChild(canvas);
    drawInitialPosition(canvas, entry.initialStones ?? [], size);
    return box;
  }

  /**
   * 挂载底部哨兵：滚动到底自动追加 10 条
   * 环境不支持 IntersectionObserver（如 jsdom）时一次性全量展示
   */
  private attachSentinel(grid: HTMLElement): void {
    if (this.displayed >= this.history.length) return;
    if (typeof IntersectionObserver === 'undefined') {
      this.displayed = this.history.length;
      this.render();
      return;
    }
    let sentinel = this.sentinel;
    if (!sentinel || !grid.contains(sentinel)) {
      sentinel = document.createElement('div');
      sentinel.setAttribute('data-history-sentinel', '');
      sentinel.style.cssText = 'height:1px;';
      grid.appendChild(sentinel);
      this.sentinel = sentinel;
    }
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (this.loadingMore) continue;
        this.loadingMore = true;
        this.io?.disconnect();
        this.displayed = Math.min(
          this.displayed + PuzzleHistoryPanel.PAGE_STEP,
          this.history.length,
        );
        this.render();
        break;
      }
    }, { root: null, rootMargin: '200px', threshold: 0 });
    this.io.observe(sentinel);
  }

  /** 清空历史 */
  async clearHistory(): Promise<void> {
    if (!(await Dialog.confirm('确定清空所有做题历史？'))) return;
    await this.config.puzzleApp.clearHistory();
    this.history = [];
    this.reset();
    this.render();
  }
}

/**
 * 绘制初始局面缩略图（含 AB/AW 摆子，不含着法）
 * @param canvas - 目标画布
 * @param stones - 初始摆子
 * @param boardSize - 棋盘路数
 */
export function drawInitialPosition(
  canvas: HTMLCanvasElement,
  stones: Array<{ x: number; y: number; color: 'black' | 'white' }>,
  boardSize: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
  let cssSize = parseInt(canvas.getAttribute('width') ?? '72', 10);
  if (cssSize < 50) cssSize = 72;
  canvas.width = cssSize * dpr;
  canvas.height = cssSize * dpr;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;

  const colors = BoardStyles.colors.wooden;
  const padding = Math.max(3, cssSize * 0.08);
  const gridSize = boardSize > 1 ? (cssSize - padding * 2) / (boardSize - 1) : 0;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, cssSize, cssSize);
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < boardSize; i++) {
    const pos = padding + i * gridSize;
    ctx.moveTo(pos, padding);
    ctx.lineTo(pos, cssSize - padding);
    ctx.moveTo(padding, pos);
    ctx.lineTo(cssSize - padding, pos);
  }
  ctx.stroke();

  const radius = gridSize * 0.46;
  for (const s of stones) {
    if (s.x < 0 || s.y < 0 || s.x >= boardSize || s.y >= boardSize) continue;
    BoardRenderer.drawStone(
      ctx,
      padding + s.x * gridSize,
      padding + s.y * gridSize,
      radius,
      s.color,
    );
  }
  ctx.restore();
}
