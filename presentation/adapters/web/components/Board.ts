/**
 * Web 棋盘组件
 * 使用 Canvas + 图片资源绘制棋盘，实现 IBoard 接口
 * 复用 BoardImageRenderer 图片渲染逻辑
 */
import type { IBoard, IBoardConfig, IBoardEvents, Position, BoardSize, HighlightType, PlayerColor } from '../../../core';
import { BoardImageRenderer, type RecommendationCircle } from './BoardImageRenderer';
export class WebBoard implements IBoard {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public readonly size: BoardSize = 19;
  private stones: Map<string, PlayerColor> = new Map();
  private highlights: Map<string, HighlightType> = new Map();
  private markers: Map<string, string> = new Map();
  private transparentMarkers: Set<string> = new Set();
  private moveNumbers: Map<string, number> = new Map();
  private recommendationCircles: RecommendationCircle[] = []; // AI 推荐圆圈
  private config: IBoardConfig = {};
  private events: IBoardEvents = {};
  private cellSize = 0;
  private container: HTMLElement | undefined;
  private mounted = false;
  private previewStone: { pos: Position; color: PlayerColor } | null = null; // 预览棋子
  private imageRenderer: BoardImageRenderer; // 图片渲染器
  constructor(container?: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.container = container;
    this.imageRenderer = new BoardImageRenderer();
    if (container) {
      container.appendChild(this.canvas);
      this.mounted = true;
    }
    this.setupEvents();
  }
  initialize(config?: IBoardConfig): void {
    this.config = { ...config };
    if (config?.size) (this as { size: BoardSize }).size = config.size;
    // 根据棋盘尺寸加载对应的图片资源
    // 图片加载完成后再渲染，避免闪烁
    this.imageRenderer.load(this.size).then(() => {
      this.render();
    }).catch(err => {
      console.error('加载棋盘图片失败', err);
      // 加载失败时仍然渲染（降级到 Canvas）
      this.render();
    });
  }
  render(): void {
    // 自动挂载到容器
    if (!this.mounted) {
      const target = this.container ?? document.getElementById('page-root') ?? document.body;
      if (!target.contains(this.canvas)) {
        target.appendChild(this.canvas);
      }
      this.mounted = true;
    }
    // 设置 canvas 尺寸 - 占满容器宽度
    const parent = this.canvas.parentElement;
    const containerWidth = parent?.clientWidth ?? 400;
    // 棋盘宽度 = 容器宽度，完全占满
    const boardWidth = Math.max(300, containerWidth);
    // 适配高 DPI 设备（Retina 屏幕等）
    // 使用实际 DPR 以获得最佳清晰度
    const dpr = window.devicePixelRatio || 1;
    // 设置 canvas 像素尺寸（物理像素）
    this.canvas.width = boardWidth * dpr;
    this.canvas.height = boardWidth * dpr;
    // 设置 canvas CSS 尺寸（CSS 像素）
    this.canvas.style.width = `${boardWidth}px`;
    this.canvas.style.height = `${boardWidth}px`;
    // 缩放绘图坐标系，使绘制逻辑使用 CSS 像素坐标
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.canvas.style.borderRadius = '8px';
    this.canvas.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    this.canvas.style.margin = '0 auto';
    this.canvas.style.display = 'block';
    this.canvas.style.background = '#DCB35C';
    // 棋盘格子大小：boardWidth / (size + 1)
    // 这样网格离棋盘边缘正好相差一格宽度，与野狐围棋一致
    this.cellSize = boardWidth / (this.size + 1);
    this.drawBoard();
    this.drawStones();
    this.drawPreviewStone();
    this.drawHighlights();
    this.drawMoveNumbers();
    this.drawMarkers();
    this.drawRecommendationCircles();
  }
  private drawBoard(): void {
    const boardWidth = this.cellSize * (this.size + 1);
    this.imageRenderer.drawBoard(
      this.ctx, 
      this.size, 
      this.cellSize,
      boardWidth
    );
  }
  private drawStones(): void {
    for (const [key, color] of Array.from(this.stones)) {
      const [x, y] = key.split(',').map(Number);
      const { cx, cy } = BoardImageRenderer.toCanvas(x!, y!, this.cellSize);
      // 棋子直径占格子的 100%，更接近野狐围棋的大小
      this.imageRenderer.drawStone(this.ctx, cx, cy, this.cellSize * 0.50, color);
    }
  }
  private drawPreviewStone(): void {
    if (!this.previewStone) return;
    const { pos, color } = this.previewStone;
    const { cx, cy } = BoardImageRenderer.toCanvas(pos.x, pos.y, this.cellSize);
    // 保存当前透明度
    const originalAlpha = this.ctx.globalAlpha;
    // 设置半透明效果
    this.ctx.globalAlpha = 0.5;
    // 绘制半透明棋子，棋子直径占格子的 100%
    this.imageRenderer.drawStone(this.ctx, cx, cy, this.cellSize * 0.50, color);
    // 恢复透明度
    this.ctx.globalAlpha = originalAlpha;
  }
  private drawHighlights(): void {
    for (const [key, type] of Array.from(this.highlights)) {
      if (type !== 'last') continue;
      const [x, y] = key.split(',').map(Number);
      const { cx, cy } = BoardImageRenderer.toCanvas(x!, y!, this.cellSize);
      const stoneColor = this.stones.get(key);
      if (stoneColor) {
        // 最后一手标记，棋子直径占格子的 100%
        this.imageRenderer.drawLastMoveMarker(this.ctx, cx, cy, this.cellSize * 0.50, stoneColor);
      }
    }
  }
  private drawMarkers(): void {
    for (const [key, marker] of Array.from(this.markers)) {
      const [x, y] = key.split(',').map(Number);
      const { cx, cy } = BoardImageRenderer.toCanvas(x!, y!, this.cellSize);
      const transparent = this.transparentMarkers.has(key);
      this.imageRenderer.drawMarker(this.ctx, cx, cy, marker, this.stones.get(key), this.cellSize * 0.8, transparent);
    }
  }
  private drawMoveNumbers(): void {
    if (!this.config.showMoveNumbers) return;
    for (const [key, number] of Array.from(this.moveNumbers)) {
      const [x, y] = key.split(',').map(Number);
      const { cx, cy } = BoardImageRenderer.toCanvas(x!, y!, this.cellSize);
      const stoneColor = this.stones.get(key);
      this.imageRenderer.drawMarker(this.ctx, cx, cy, String(number), stoneColor, this.cellSize * 0.55);
    }
    // 最后一手同时显示手数和描点
  }
  private drawRecommendationCircles(): void {
    const total = this.recommendationCircles.length;
    for (const circle of this.recommendationCircles) {
      const { cx, cy } = BoardImageRenderer.toCanvas(circle.x, circle.y, this.cellSize);
      this.imageRenderer.drawRecommendationCircle(this.ctx, cx, cy, this.cellSize, circle.rank, total, circle.isActualMove);
    }
  }
  placeStone(pos: Position, color: PlayerColor): void {
    this.stones.set(`${pos.x},${pos.y}`, color);
    this.render();
  }
  removeStone(pos: Position): void {
    this.stones.delete(`${pos.x},${pos.y}`);
    this.render();
  }
  clear(): void {
    this.stones.clear();
    this.highlights.clear();
    this.markers.clear();
    this.transparentMarkers.clear();
    this.moveNumbers.clear();
    this.previewStone = null;
    this.recommendationCircles = [];
    this.render();
  }
  clearHighlights(): void {
    this.highlights.clear();
    this.render();
  }
  setStones(stones: Array<{ pos: Position; color: PlayerColor | null }>): void {
    this.stones.clear();
    for (const { pos, color } of stones) {
      if (color) this.stones.set(`${pos.x},${pos.y}`, color);
    }
    this.render();
  }
  getStones(): Map<string, PlayerColor> {
    return new Map(this.stones);
  }
  highlight(pos: Position, type: HighlightType): void {
    this.highlights.set(`${pos.x},${pos.y}`, type);
    this.render();
  }
  clearHighlight(): void {
    this.highlights.clear();
    this.render();
  }
  setMarker(pos: Position, marker: string, transparent?: boolean): void {
    this.markers.set(`${pos.x},${pos.y}`, marker);
    this.transparentMarkers = this.transparentMarkers || new Set();
    if (transparent) {
      this.transparentMarkers.add(`${pos.x},${pos.y}`);
    } else {
      this.transparentMarkers.delete(`${pos.x},${pos.y}`);
    }
    this.render();
  }
  setMoveNumber(pos: Position, number: number): void {
    this.moveNumbers.set(`${pos.x},${pos.y}`, number);
    this.render();
  }
  setPreviewStone(pos: Position | null, color: PlayerColor): void {
    if (pos) {
      this.previewStone = { pos, color };
    } else {
      this.previewStone = null;
    }
    this.render();
  }
  clearPreviewStone(): void {
    this.previewStone = null;
    this.render();
  }
  clearMoveNumbers(): void {
    this.moveNumbers.clear();
    this.render();
  }
  clearMarkers(): void {
    this.markers.clear();
    this.transparentMarkers.clear();
    this.render();
  }
  setMoveNumbers(moves: Array<{ pos: Position; number: number }>): void {
    this.moveNumbers.clear();
    for (const { pos, number } of moves) {
      this.moveNumbers.set(`${pos.x},${pos.y}`, number);
    }
    this.render();
  }
  /** 设置 AI 推荐圆圈 */
  setRecommendationCircles(circles: RecommendationCircle[]): void {
    this.recommendationCircles = [...circles];
    this.render();
  }
  /** 清除 AI 推荐圆圈 */
  clearRecommendationCircles(): void {
    this.recommendationCircles = [];
    this.render();
  }
  /** 检查点击是否在某个推荐圆圈上，返回该圆圈 */
  getClickedRecommendation(x: number, y: number): RecommendationCircle | null {
    for (const circle of this.recommendationCircles) {
      if (circle.x === x && circle.y === y) {
        return circle;
      }
    }
    return null;
  }
  on(events: IBoardEvents): void {
    this.events = { ...this.events, ...events };
  }
  private setupEvents(): void {
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      // 点击位置转换为棋盘坐标（0-18）
      const x = Math.round((e.clientX - rect.left) / this.cellSize) - 1;
      const y = Math.round((e.clientY - rect.top) / this.cellSize) - 1;
      if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
        this.events.onClick?.({ x, y });
      }
    });
  }
  destroy(): void {
    this.canvas.remove();
  }
}
