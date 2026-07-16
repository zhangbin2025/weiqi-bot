/**
 * 围棋缩略图组件
 * 纯 Presentation 层：只负责渲染，复用 BoardRenderer
 * @module presentation/adapters/web/components/BoardThumbnail
 */
import type { PlayerColor } from '../../../../domain/primitives';
import type { ThumbnailMove, ThumbnailOptions } from './types';
import { BoardRenderer } from './BoardRenderer';
import { BoardStyles } from './Board.styles';
/** 缩略图组件 - 纯渲染 */
export class BoardThumbnail {
  /** 渲染缩略图 */
  static render(canvas: HTMLCanvasElement, moves: ThumbnailMove[], options?: ThumbnailOptions): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const movesToRender = options?.prefixLen && moves.length > options.prefixLen ? moves.slice(0, options.prefixLen) : moves;
    const boardState = this.buildBoardState(movesToRender);
    const dpr = Math.min(options?.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1, 2);
    let cssSize = parseInt(canvas.getAttribute('width') ?? '100', 10);
    if (cssSize < 50) cssSize = 100;
    canvas.width = canvas.height = cssSize * dpr;
    canvas.style.width = canvas.style.height = `${cssSize}px`;
    const displaySize = options?.displaySize ?? 13;
    const theme = options?.theme ?? 'wooden';
    const startX = 19 - displaySize;
    const padding = cssSize * 0.05;
    const gridSize = (cssSize - padding * 2) / (displaySize - 1);
    ctx.save();
    ctx.scale(dpr, dpr);
    this.drawPartialBoard(ctx, cssSize, padding, gridSize, displaySize, theme, startX);
    const r = gridSize * 0.45;
    for (const [key, color] of boardState) {
      const [x, y] = key.split(',').map(Number);
      if (x! >= startX && y! < displaySize) {
        BoardRenderer.drawStone(ctx, padding + (x! - startX) * gridSize, padding + y! * gridSize, r, color);
      }
    }
    ctx.restore();
  }
  /** 绘制部分棋盘 */
  private static drawPartialBoard(
    ctx: CanvasRenderingContext2D,
    cssSize: number,
    padding: number,
    gridSize: number,
    displaySize: number,
    theme: 'classic' | 'wooden' | 'modern',
    startX: number
  ): void {
    const colors = BoardStyles.colors[theme] ?? BoardStyles.colors.wooden;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, cssSize, cssSize);
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    for (let i = 0; i < displaySize; i++) {
      const pos = padding + i * gridSize;
      ctx.beginPath();
      ctx.moveTo(pos, padding);
      ctx.lineTo(pos, cssSize - padding);
      ctx.moveTo(padding, pos);
      ctx.lineTo(cssSize - padding, pos);
      ctx.stroke();
    }
    ctx.fillStyle = colors.star;
    for (const [sx, sy] of [[15, 3], [9, 3]] as [number, number][]) {
      if (sx >= startX && sy < displaySize) {
        ctx.beginPath();
        ctx.arc(padding + (sx - startX) * gridSize, padding + sy * gridSize, Math.max(2, gridSize * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  /** 批量渲染（调用方需要先解析数据） */
  static renderAll(
    selector: string = 'canvas.joseki-thumbnail',
    getMoves: (canvas: HTMLCanvasElement) => ThumbnailMove[] | null
  ): void {
    if (typeof document === 'undefined') return;
    const canvases = document.querySelectorAll<HTMLCanvasElement>(selector);
    if (!canvases.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const c = e.target as HTMLCanvasElement;
        if (c.dataset['rendered'] === 'true') continue;
        const moves = getMoves(c);
        if (moves && moves.length) {
          const pl = parseInt(c.dataset['prefixLen'] ?? '0', 10);
          const theme = c.dataset['theme'] as 'classic' | 'wooden' | 'modern' | undefined;
          this.render(c, moves, { prefixLen: pl > 0 ? pl : undefined, theme });
          c.dataset['rendered'] = 'true';
        }
        observer.unobserve(c);
      }
    }, { rootMargin: '50px 0px', threshold: 0 });
    canvases.forEach(c => { if (c.dataset['rendered'] !== 'true') observer.observe(c); });
  }
  private static buildBoardState(moves: ThumbnailMove[]): Map<string, PlayerColor> {
    const board = new Map<string, PlayerColor>();
    for (const m of moves) {
      if (!m.isPass && m.x >= 0 && m.y >= 0) board.set(`${m.x},${m.y}`, m.color);
    }
    return board;
  }
}
export type { ThumbnailMove, ThumbnailOptions } from './types';