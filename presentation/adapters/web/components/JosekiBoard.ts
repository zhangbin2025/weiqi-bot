/**
 * 定式专用棋盘组件
 * @module presentation/adapters/web/components/JosekiBoard
 * 
 * 基于 demo joseki-board.js 移植
 * 特性：19路棋盘截取右上角13路、分支热度标记、脱先标记、手数标记
 */
import type { PlayerColor } from '../../../../domain/primitives';
import type { IBoard } from '../../../../domain/board';
import type { IAudioPlayer, SoundType } from '../../../../infrastructure/audio/IAudioPlayer';
import { CaptureRule } from '../../../../domain/rules/CaptureRule';
import { toAbsoluteUrl } from '../../../../infrastructure/utils/web/pathUtils';
/** 图片资源路径（使用相对路径，支持子目录部署） */
const IMAGE_PATHS = {
  board: 'images/board/chessBoard_1.png',
  lines13: 'images/board/boardLine_13_1.png',
  blackStone: 'images/board/blackStone1001.png',
  whiteStone: 'images/board/whiteStone1001.png',
};
/** 图片缓存（使用绝对路径作为 key） */
const imageCache: Map<string, HTMLImageElement> = new Map();
/** 加载图片 */
function loadImage(src: string): Promise<HTMLImageElement> {
  // 转换为绝对路径（支持子目录部署）
  const absoluteSrc = toAbsoluteUrl(src);
  if (imageCache.has(absoluteSrc)) {
    return Promise.resolve(imageCache.get(absoluteSrc)!);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(absoluteSrc, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = absoluteSrc;
  });
}
/** 分支选点 */
export interface JosekiBranch {
  x: number;
  y: number;
  color: PlayerColor;
  sgf: string;
  heat?: number;
  isPass?: boolean;
}
const BOARD_SIZE = 19;
const DISPLAY_SIZE = 13;
/** 简单的棋盘适配器（实现 IBoard 接口） */
class SimpleBoard implements IBoard {
  readonly size = BOARD_SIZE;
  private board: (PlayerColor | null)[][];
  constructor(board?: (PlayerColor | null)[][]) {
    this.board = board ?? Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
  }
  getStone(x: number, y: number): PlayerColor | null {
    return this.board[y]?.[x] ?? null;
  }
  setStone(x: number, y: number, color: PlayerColor | null): void {
    if (this.board[y]) {
      this.board[y]![x] = color;
    }
  }
  isValidPosition(x: number, y: number): boolean {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
  }
  clone(): IBoard {
    return new SimpleBoard(this.board.map(row => row?.slice() ?? []));
  }
  getPoint(x: number, y: number): PlayerColor | null {
    return this.getStone(x, y);
  }
  getBoardArray(): (PlayerColor | null)[][] {
    return this.board;
  }
}
export class JosekiBoard {
  public canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private board: (PlayerColor | null)[][] = [];
  private currentMoves: Array<{ x: number; y: number; color: PlayerColor; isPass?: boolean }> = [];
  private branches: JosekiBranch[] = [];
  private clickHandler?: (pos: { x: number; y: number }) => void;
  private passMark: { cx: number; cy: number; radius: number } | undefined;
  private readonly startX = BOARD_SIZE - DISPLAY_SIZE; // 6
  private readonly startY = 0;
  private initialized = false;
  private audioPlayer?: IAudioPlayer | undefined;
  // 图片资源
  private images: {
    board: HTMLImageElement | null;
    lines: HTMLImageElement | null;
    blackStone: HTMLImageElement | null;
    whiteStone: HTMLImageElement | null;
  } = {
    board: null,
    lines: null,
    blackStone: null,
    whiteStone: null,
  };
  private imagesLoaded = false;
  constructor(container?: HTMLElement, audioPlayer?: IAudioPlayer) {
    this.canvas = document.createElement('canvas');
    this.audioPlayer = audioPlayer ?? undefined;
    this.canvas.className = 'joseki-board';
    this.canvas.style.cssText = `
      width: 100%;
      aspect-ratio: 1;
      display: block;
      margin: 0 auto;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    `;
    if (container) {
      container.appendChild(this.canvas);
    }
    this.ctx = this.canvas.getContext('2d')!;
    this.initBoard();
  }
  private initBoard(): void {
    this.board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
  }
  initialize(_config?: { size?: number; showCoordinates?: boolean }): void {
    this.initialized = true;
    // 加载图片资源
    // 图片加载完成后再渲染，避免闪烁
    this.loadImages().then(() => {
      // 延迟调用 resize，确保 CSS 完全加载和容器宽度计算完成
      setTimeout(() => {
        this.resize();
        this.render();
      }, 0);
    }).catch(err => {
      console.error('加载定式棋盘图片失败', err);
      // 加载失败时仍然渲染（降级到 Canvas）
      setTimeout(() => {
        this.resize();
        this.render();
      }, 0);
    });
  }
  /** 加载图片资源 */
  private async loadImages(): Promise<void> {
    if (this.imagesLoaded) return;
    // 只加载背景和棋子图片，不加载线条图片
    // 因为 Canvas 计算的圆心位置需要与线条图片中的交叉点精确对齐
    // 使用 Canvas 绘制线条可以保证圆圈位置准确
    const [board, blackStone, whiteStone] = await Promise.all([
      loadImage(IMAGE_PATHS.board),
      loadImage(IMAGE_PATHS.blackStone),
      loadImage(IMAGE_PATHS.whiteStone),
    ]);
    this.images.board = board;
    this.images.lines = null; // 不使用线条图片
    this.images.blackStone = blackStone;
    this.images.whiteStone = whiteStone;
    this.imagesLoaded = true;
  }
  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    if (w <= 0) return;
    this.canvas.width = w * this.dpr;
    this.canvas.height = w * this.dpr;
  }
  on(handlers: { onClick?: (pos: { x: number; y: number }) => void }): void {
    if (handlers.onClick) {
      this.clickHandler = handlers.onClick;
      this.canvas.addEventListener('click', this.handleClick.bind(this));
    }
  }
  setMoves(moves: Array<{ x: number; y: number; color: PlayerColor; isPass?: boolean }>): void {
    this.currentMoves = moves;
    this.rebuildBoard();
    this.render();
  }
  setBranches(branches: JosekiBranch[]): void {
    this.branches = branches;
    this.render();
  }
  clear(): void {
    this.currentMoves = [];
    this.branches = [];
    this.initBoard();
    this.render();
  }
  /** 获取脱先标记位置（相对于 canvas） */
  getPassMarkPosition(): { x: number; y: number; radius: number } | null {
    if (!this.passMark) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + this.passMark.cx,
      y: rect.top + this.passMark.cy,
      radius: this.passMark.radius,
    };
  }
  private rebuildBoard(): void {
    this.initBoard();
    const captureRule = new CaptureRule();
    const board = new SimpleBoard(this.board);
    for (const move of this.currentMoves) {
      if (!move.isPass && move.x >= 0 && move.x < BOARD_SIZE && move.y >= 0 && move.y < BOARD_SIZE) {
        board.setStone(move.x, move.y, move.color);
        // 执行提子判定
        const result = captureRule.capture(board, move.x, move.y, move.color);
        for (const coord of result.captured) {
          board.setStone(coord.x, coord.y, null);
        }
      }
    }
    // 同步回内部数组
    this.board = board.getBoardArray();
  }
  render(): void {
    if (!this.initialized) {
      this.resize();
      this.initialized = true;
    }
    // 确保 canvas 尺寸正确
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    if (this.canvas.width !== Math.round(rect.width * this.dpr)) {
      this.resize();
    }
    const ctx = this.ctx;
    const canvasSize = this.canvas.width; // 物理像素
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    const logicalSize = canvasSize / this.dpr;
    // 绘制背景
    if (this.images.board) {
      // 使用图片绘制背景
      ctx.drawImage(this.images.board, 0, 0, logicalSize, logicalSize);
    } else {
      // 降级：使用纯色背景
      ctx.fillStyle = '#DCB35C';
      ctx.fillRect(0, 0, logicalSize, logicalSize);
    }
    const padding = logicalSize * 0.05;
    const gridSize = (logicalSize - padding * 2) / (DISPLAY_SIZE - 1);
    // 绘制线条
    if (this.images.lines) {
      // 使用图片绘制线条
      ctx.drawImage(this.images.lines, 0, 0, logicalSize, logicalSize);
    } else {
      // 降级：使用 Canvas 绘制线条
      ctx.strokeStyle = '#8B7355';
      ctx.lineWidth = 1;
      for (let i = 0; i < DISPLAY_SIZE; i++) {
        const pos = padding + i * gridSize;
        // 竖线
        ctx.beginPath();
        ctx.moveTo(pos, padding);
        ctx.lineTo(pos, logicalSize - padding);
        ctx.stroke();
        // 横线
        ctx.beginPath();
        ctx.moveTo(padding, pos);
        ctx.lineTo(logicalSize - padding, pos);
        ctx.stroke();
      }
      // 星位
      ctx.fillStyle = '#333';
      const stars: [number, number][] = [[9, 3]];
      for (const [sx, sy] of stars) {
        const localX = sx - this.startX;
        const localY = sy - this.startY;
        if (localX >= 0 && localX < DISPLAY_SIZE && localY >= 0 && localY < DISPLAY_SIZE) {
          ctx.beginPath();
          ctx.arc(padding + localX * gridSize, padding + localY * gridSize, Math.max(2, gridSize * 0.1), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // 棋子
    const stoneRadius = gridSize * 0.45;
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const color = this.board[y]?.[x];
        if (!color) continue;
        const localX = x - this.startX;
        const localY = y - this.startY;
        if (localX >= 0 && localX < DISPLAY_SIZE && localY >= 0 && localY < DISPLAY_SIZE) {
          this.drawStone(ctx, padding + localX * gridSize, padding + localY * gridSize, stoneRadius, color);
        }
      }
    }
    // 分支标记
    this.drawBranches(ctx, logicalSize, padding, gridSize);
    // 手数标记（最后一手）
    if (this.currentMoves.length > 0) {
      const lastMove = this.currentMoves[this.currentMoves.length - 1];
      if (lastMove && !lastMove.isPass) {
        const localX = lastMove.x - this.startX;
        const localY = lastMove.y - this.startY;
        if (localX >= 0 && localX < DISPLAY_SIZE && localY >= 0 && localY < DISPLAY_SIZE) {
          const cx = padding + localX * gridSize;
          const cy = padding + localY * gridSize;
          ctx.font = `bold ${gridSize * 0.35}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = lastMove.color === 'black' ? '#fff' : '#000';
          ctx.fillText(String(this.currentMoves.length), cx, cy);
        }
      }
    }
    ctx.restore();
  }
  private drawStone(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: PlayerColor): void {
    const stoneImg = color === 'black' ? this.images.blackStone : this.images.whiteStone;
    if (stoneImg) {
      // 使用图片绘制棋子
      ctx.drawImage(
        stoneImg,
        cx - radius,
        cy - radius,
        radius * 2,
        radius * 2
      );
    } else {
      // 降级：使用 Canvas 绘制棋子
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(
        cx - radius * 0.3, cy - radius * 0.3, radius * 0.1,
        cx, cy, radius
      );
      if (color === 'black') {
        gradient.addColorStop(0, '#555');
        gradient.addColorStop(1, '#000');
      } else {
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(1, '#bbb');
      }
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = color === 'black' ? '#333' : '#999';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
  private drawBranches(ctx: CanvasRenderingContext2D, logicalSize: number, padding: number, gridSize: number): void {
    if (this.branches.length === 0) {
      this.passMark = undefined;
      return;
    }
    // 计算热度范围
    const heats = this.branches.map(b => b.heat || 0);
    const maxHeat = Math.max(...heats, 1);
    const minHeat = Math.min(...heats, 0);
    const hasHeatData = heats.some(h => h > 0);
    for (const branch of this.branches) {
      if (branch.isPass) {
        // 脱先：左下角
        const cx = padding;
        const cy = logicalSize - padding;
        const heat = branch.heat || 0;
        let radius: number, alpha: number, lineWidth: number;
        if (!hasHeatData) {
          radius = gridSize * 0.35;
          alpha = 0.5;
          lineWidth = 2;
        } else {
          const logMin = Math.log(minHeat + 1);
          const logMax = Math.log(maxHeat + 1);
          const logHeat = Math.log(heat + 1);
          const ratio = logMax > logMin ? (logHeat - logMin) / (logMax - logMin) : 0.5;
          const minRadius = gridSize * 0.12;
          const maxRadius = gridSize * 0.30;
          radius = minRadius + ratio * (maxRadius - minRadius);
          const minAlpha = 0.25;
          const maxAlpha = 0.65;
          alpha = minAlpha + ratio * (maxAlpha - minAlpha);
          const minLineWidth = 1;
          const maxLineWidth = 3;
          lineWidth = minLineWidth + ratio * (maxLineWidth - minLineWidth);
        }
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = branch.color === 'black' ? `rgba(255, 152, 0, ${alpha})` : `rgba(33, 150, 243, ${alpha})`;
        ctx.fill();
        ctx.strokeStyle = branch.color === 'black' ? '#FF9800' : '#2196F3';
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${radius * 1.2}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⊘', cx, cy);
        this.passMark = { cx, cy, radius };
        continue;
      }
      const displayX = branch.x - this.startX;
      const displayY = branch.y - this.startY;
      if (displayX < 0 || displayX >= DISPLAY_SIZE || displayY < 0 || displayY >= DISPLAY_SIZE) continue;
      const cx = padding + displayX * gridSize;
      const cy = padding + displayY * gridSize;
      const heat = branch.heat || 0;
      let radius: number, alpha: number, lineWidth: number;
      if (!hasHeatData) {
        radius = gridSize * 0.35;
        alpha = 0.5;
        lineWidth = 2;
      } else {
        const logMin = Math.log(minHeat + 1);
        const logMax = Math.log(maxHeat + 1);
        const logHeat = Math.log(heat + 1);
        const ratio = logMax > logMin ? (logHeat - logMin) / (logMax - logMin) : 0.5;
        const minRadius = gridSize * 0.12;
        const maxRadius = gridSize * 0.30;
        radius = minRadius + ratio * (maxRadius - minRadius);
        const minAlpha = 0.25;
        const maxAlpha = 0.65;
        alpha = minAlpha + ratio * (maxAlpha - minAlpha);
        const minLineWidth = 1;
        const maxLineWidth = 3;
        lineWidth = minLineWidth + ratio * (maxLineWidth - minLineWidth);
      }
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = branch.color === 'black' ? `rgba(255, 152, 0, ${alpha})` : `rgba(33, 150, 243, ${alpha})`;
      ctx.fill();
      ctx.strokeStyle = branch.color === 'black' ? '#FF9800' : '#2196F3';
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }
  private handleClick(e: MouseEvent): void {
    if (!this.clickHandler) return;
    const rect = this.canvas.getBoundingClientRect();
    // 逻辑像素坐标
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const logicalSize = rect.width;
    const padding = logicalSize * 0.05;
    const gridSize = (logicalSize - padding * 2) / (DISPLAY_SIZE - 1);
    // 检查脱先
    if (this.passMark) {
      const dx = canvasX - this.passMark.cx;
      const dy = canvasY - this.passMark.cy;
      if (Math.sqrt(dx * dx + dy * dy) <= this.passMark.radius) {
        this.audioPlayer?.play('pass');
        this.clickHandler({ x: -1, y: -1 });
        return;
      }
    }
    const localX = Math.round((canvasX - padding) / gridSize);
    const localY = Math.round((canvasY - padding) / gridSize);
    if (localX < 0 || localX >= DISPLAY_SIZE || localY < 0 || localY >= DISPLAY_SIZE) {
      return;
    }
    const boardX = this.startX + localX;
    const boardY = this.startY + localY;
    // 检查是否已有棋子
    if (this.board[boardY]?.[boardX]) {
      return;
    }
    // 只允许点击候选选点（如果 branches 为空则允许任意空位）
    if (this.branches.length > 0) {
      const isValidBranch = this.branches.some(b => b.x === boardX && b.y === boardY);
      if (!isValidBranch) {
        return;
      }
    }
    this.clickHandler({ x: boardX, y: boardY });
    this.audioPlayer?.play('stone');
  }
  destroy(): void {
    this.canvas.remove();
  }
  /** 播放音效 */
  playSound(type: SoundType): void {
    this.audioPlayer?.play(type);
  }
}
