/**
 * 棋盘图片渲染器 - 使用图片资源渲染棋盘
 * @module presentation/adapters/web/components/BoardImageRenderer
 * 
 * 参考野狐围棋的实现方式：
 * - 棋盘背景：chessBoard_1.png (750x751)
 * - 棋盘线条：boardLine_19_1.png (1500x1500, 2x分辨率)
 * - 黑子：blackStone1001.png (80x80)
 * - 白子：whiteStone1001.png (80x80)
 */
import type { PlayerColor } from '../../../../domain/primitives';
import { toAbsoluteUrl } from '../../../../infrastructure/utils/web/pathUtils';
/** 图片资源路径（使用相对路径，支持子目录部署） */
const IMAGE_PATHS = {
  board: 'images/board/chessBoard_1.png',
  lines: {
    19: 'images/board/boardLine_19_1.png',
    13: 'images/board/boardLine_13_1.png',
    9: 'images/board/boardLine_9_1.png',
  },
  blackStone: 'images/board/blackStone1001.png',
  whiteStone: 'images/board/whiteStone1001.png',
};
/** 标准棋盘尺寸 */
const STANDARD_SIZES = [19, 13, 9];
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
/** 预加载所有图片（默认加载19路） */
export async function preloadBoardImages(): Promise<void> {
  await Promise.all([
    loadImage(IMAGE_PATHS.board),
    loadImage(IMAGE_PATHS.lines[19]),
    loadImage(IMAGE_PATHS.lines[13]),
    loadImage(IMAGE_PATHS.lines[9]),
    loadImage(IMAGE_PATHS.blackStone),
    loadImage(IMAGE_PATHS.whiteStone),
  ]);
}
/** AI 推荐圆圈配置 */
export interface RecommendationCircle {
  x: number;
  y: number;
  rank: number;
  pv?: string[] | undefined;
  isActualMove?: boolean; // 是否是实战落点
}
/** 棋盘图片渲染器 */
export class BoardImageRenderer {
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
  private loaded = false;
  private loadedSize: number | null = null; // 记录当前加载的棋盘尺寸
  /** 加载图片资源 */
  async load(size: number = 19): Promise<void> {
    // 如果已经加载过相同尺寸的图片，直接返回
    if (this.loaded && this.loadedSize === size) {
      return;
    }
    // 只加载棋子和背景图片，不加载线条图片
    // 原因：线条图片在高 DPR 设备上缩小后线条变细，不够清晰
    // 使用 Canvas 绘制线条可以根据 DPR 调整线条宽度，更清晰
    const [board, blackStone, whiteStone] = await Promise.all([
      loadImage(IMAGE_PATHS.board),
      loadImage(IMAGE_PATHS.blackStone),
      loadImage(IMAGE_PATHS.whiteStone),
    ]);
    this.images.board = board;
    this.images.lines = null; // 不使用线条图片
    this.images.blackStone = blackStone;
    this.images.whiteStone = whiteStone;
    this.loaded = true;
    this.loadedSize = size;
  }
  /**
   * 绘制棋盘背景和线条
   */
  drawBoard(
    ctx: CanvasRenderingContext2D,
    size: number,
    cellSize: number,
    boardWidth: number
  ): void {
    if (!this.images.board) {
      // 图片未加载，绘制简单的背景
      ctx.fillStyle = '#DCB35C';
      ctx.fillRect(0, 0, boardWidth, boardWidth);
      return;
    }
    // 绘制棋盘背景（拉伸到整个棋盘大小）
    ctx.drawImage(this.images.board, 0, 0, boardWidth, boardWidth);
    if (this.images.lines) {
      // 有线条图片，使用图片绘制
      ctx.drawImage(this.images.lines, 0, 0, boardWidth, boardWidth);
    } else {
      // 没有线条图片（非标准尺寸），使用 Canvas 绘制
      this.drawBoardLines(ctx, size, cellSize, boardWidth);
    }
  }
  /**
   * 使用 Canvas 绘制棋盘线条（降级方案）
   */
  private drawBoardLines(
    ctx: CanvasRenderingContext2D,
    size: number,
    cellSize: number,
    boardWidth: number
  ): void {
    ctx.strokeStyle = '#8B7355';
    // 线条宽度根据 cellSize 动态调整，在小屏幕上也清晰可见
    ctx.lineWidth = Math.max(1, cellSize * 0.015);
    for (let i = 1; i <= size; i++) {
      const p = i * cellSize;
      // 横线
      ctx.beginPath();
      ctx.moveTo(cellSize, p);
      ctx.lineTo(size * cellSize, p);
      ctx.stroke();
      // 竖线
      ctx.beginPath();
      ctx.moveTo(p, cellSize);
      ctx.lineTo(p, size * cellSize);
      ctx.stroke();
    }
    // 绘制星位
    ctx.fillStyle = '#333';
    const starPoints: [number, number][] = size === 19 
      ? [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]]
      : size === 13
      ? [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]]
      : size === 9
      ? [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]]
      : [];
    for (const [x, y] of starPoints) {
      const px = (x + 1) * cellSize;
      const py = (y + 1) * cellSize;
      const starRadius = Math.max(2, cellSize * 0.1);
      ctx.beginPath();
      ctx.arc(px, py, starRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  /**
   * 绘制棋子
   */
  drawStone(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    color: PlayerColor
  ): void {
    const img = color === 'black' ? this.images.blackStone : this.images.whiteStone;
    if (!img) {
      // 图片未加载，使用简单的圆形
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = color === 'black' ? '#000' : '#fff';
      ctx.fill();
      ctx.strokeStyle = color === 'black' ? '#333' : '#ccc';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }
    // 计算绘制尺寸（棋子图片是 80x80，我们根据 radius 来缩放）
    const diameter = radius * 2;
    // 绘制棋子图片，居中对齐
    ctx.drawImage(
      img,
      cx - radius,
      cy - radius,
      diameter,
      diameter
    );
  }
  /**
   * 绘制最后一手标记（黑子中间白点，白子中间黑点）
   */
  drawLastMoveMarker(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    stoneColor: PlayerColor
  ): void {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = stoneColor === 'black' ? '#fff' : '#000';
    ctx.fill();
  }
  /**
   * 绘制标记（A, B, C 或数字）
   */
  drawMarker(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    marker: string,
    stoneColor?: PlayerColor,
    fontSize?: number,
    transparent?: boolean
  ): void {
    const size = fontSize ?? 14;
    // 空交叉点上的选点标记
    if (!stoneColor && !transparent) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      ctx.fill();
      ctx.strokeStyle = '#667eea';
      ctx.lineWidth = Math.max(1, size * 0.12);
      ctx.stroke();
      ctx.restore();
    }
    // 透明模式描边
    if (transparent) {
      ctx.save();
      ctx.font = `bold ${size}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = size * 0.15;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(marker, cx, cy);
      ctx.restore();
    }
    ctx.font = `bold ${size}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = stoneColor === 'black' ? '#fff' : '#667eea';
    ctx.fillText(marker, cx, cy);
  }
  /**
   * 绘制 AI 推荐圆圈
   * @param ctx Canvas 上下文
   * @param cx 圆心 x 坐标
   * @param cy 圆心 y 坐标
   * @param cellSize 格子大小
   * @param rank 当前排名（1 开始）
   * @param total 总共多少个圆圈（用于计算半径）
   */
  drawRecommendationCircle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    cellSize: number,
    rank: number,
    total: number = 5,
    isActualMove: boolean = false
  ): void {
    ctx.save();
    
    // 实战落点：红色虚线圆圈，不显示数字
    if (isActualMove) {
      const radius = cellSize * 0.32;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = Math.max(2, cellSize * 0.06);
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }
    
    // 正常推荐选点：橙色圆圈 + 数字
    // 半径范围：最大 0.38，最小 0.22
    const maxRadius = cellSize * 0.38;
    const minRadius = cellSize * 0.22;
    
    // 计算半径：排名 1 最大，排名 last 最小
    let radius: number;
    if (total <= 1) {
      radius = maxRadius;
    } else {
      const t = (rank - 1) / (total - 1);  // 0 ~ 1
      radius = maxRadius - t * (maxRadius - minRadius);
    }

    const alpha = Math.max(0.5, 1 - (rank - 1) * 0.12);
    const hue = 35;
    const saturation = 95;
    const lightness = 50;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha * 0.3})`;
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
    ctx.lineWidth = Math.max(2, cellSize * 0.06);
    ctx.stroke();

    const fontSize = Math.max(10, cellSize * 0.28);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
    ctx.fillText(String(rank), cx, cy);
    ctx.restore();
  }
  /**
   * 坐标转画布位置
   */
  static toCanvas(x: number, y: number, cellSize: number): { cx: number; cy: number } {
    return { cx: (x + 1) * cellSize, cy: (y + 1) * cellSize };
  }
}
