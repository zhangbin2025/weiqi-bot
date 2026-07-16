/**
 * 围棋定式缩略图组件
 * @module presentation/adapters/web/components/JosekiThumbnail
 * 
 * 使用图片资源渲染棋盘，提升清晰度
 * 使用 domain 层的 CaptureRule 处理提子逻辑
 */
import type { PlayerColor } from '../../../../domain/primitives';
import type { IBoard } from '../../../../domain/board';
import { CaptureRule } from '../../../../domain/rules/CaptureRule';
import { toAbsoluteUrl } from '../../../../infrastructure/utils/web/pathUtils';
const BOARD_SIZE = 19;
const DISPLAY_SIZE = 13;
/** 图片资源路径（使用相对路径，支持子目录部署） */
const IMAGE_PATHS = {
  board: 'images/board/chessBoard_1.png',
  lines13: 'images/board/boardLine_13_1.png',
  blackStone: 'images/board/blackStone1001.png',
  whiteStone: 'images/board/whiteStone1001.png',
};
/** 图片缓存（使用绝对路径作为 key） */
const thumbnailImageCache: Map<string, HTMLImageElement> = new Map();
/** 加载图片 */
function loadThumbnailImage(src: string): Promise<HTMLImageElement> {
  // 转换为绝对路径（支持子目录部署）
  const absoluteSrc = toAbsoluteUrl(src);
  if (thumbnailImageCache.has(absoluteSrc)) {
    return Promise.resolve(thumbnailImageCache.get(absoluteSrc)!);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      thumbnailImageCache.set(absoluteSrc, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = absoluteSrc;
  });
}
/** 检查图片是否已加载 */
function isImagesLoaded(): boolean {
  return thumbnailImageCache.has(toAbsoluteUrl(IMAGE_PATHS.board)) &&
         thumbnailImageCache.has(toAbsoluteUrl(IMAGE_PATHS.lines13)) &&
         thumbnailImageCache.has(toAbsoluteUrl(IMAGE_PATHS.blackStone)) &&
         thumbnailImageCache.has(toAbsoluteUrl(IMAGE_PATHS.whiteStone));
}
/** 预加载缩略图图片 */
export async function preloadThumbnailImages(): Promise<void> {
  await Promise.all([
    loadThumbnailImage(IMAGE_PATHS.board),
    loadThumbnailImage(IMAGE_PATHS.lines13),
    loadThumbnailImage(IMAGE_PATHS.blackStone),
    loadThumbnailImage(IMAGE_PATHS.whiteStone),
  ]);
}
interface Move {
  x: number;
  y: number;
  color: PlayerColor;
  isPass?: boolean;
}
/**
 * 简单的棋盘适配器（实现 IBoard 接口）
 */
class SimpleBoard implements IBoard {
  readonly size = BOARD_SIZE;
  private board: (PlayerColor | null)[][];
  constructor() {
    this.board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
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
    const cloned = new SimpleBoard();
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        cloned.setStone(x, y, this.board[y]?.[x] ?? null);
      }
    }
    return cloned;
  }
  getPoint(x: number, y: number): PlayerColor | null {
    return this.getStone(x, y);
  }
  /** 获取内部数组（用于渲染） */
  getBoardArray(): (PlayerColor | null)[][] {
    return this.board;
  }
}
/** 绘制棋子（Canvas） */
function drawStoneWithCanvas(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: PlayerColor): void {
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
/**
 * 构建棋盘状态（使用 CaptureRule 处理提子）
 */
function buildBoardState(moves: Move[]): (PlayerColor | null)[][] {
  const board = new SimpleBoard();
  const captureRule = new CaptureRule();
  for (const move of moves) {
    if (!move.isPass && move.x >= 0 && move.x < BOARD_SIZE && move.y >= 0 && move.y < BOARD_SIZE) {
      board.setStone(move.x, move.y, move.color);
      // 执行提子判定
      const result = captureRule.capture(board, move.x, move.y, move.color);
      // 移除被提的棋子
      for (const coord of result.captured) {
        board.setStone(coord.x, coord.y, null);
      }
    }
  }
  return board.getBoardArray();
}
/**
 * 绘制缩略图
 */
export function drawJosekiThumbnail(canvas: HTMLCanvasElement, moves: Move[], size = 100): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  ctx.save();
  ctx.scale(dpr, dpr);
  const startX = BOARD_SIZE - DISPLAY_SIZE; // 6
  const startY = 0;
  const padding = size * 0.05;
  const gridSize = (size - padding * 2) / (DISPLAY_SIZE - 1);
  // 检查图片是否已加载（使用绝对路径作为 key）
  const boardImg = thumbnailImageCache.get(toAbsoluteUrl(IMAGE_PATHS.board));
  const linesImg = thumbnailImageCache.get(toAbsoluteUrl(IMAGE_PATHS.lines13));
  const blackStoneImg = thumbnailImageCache.get(toAbsoluteUrl(IMAGE_PATHS.blackStone));
  const whiteStoneImg = thumbnailImageCache.get(toAbsoluteUrl(IMAGE_PATHS.whiteStone));
  // 对于缩略图，使用 Canvas 绘制线条和棋子更清晰
  // 因为将高分辨率图片缩小到小尺寸会导致失真
  // 只有在较大尺寸（>200px）时才使用图片绘制
  const useImageForLines = size > 200;
  const useImageForStones = size > 200;
  if (boardImg && blackStoneImg && whiteStoneImg) {
    // 使用图片渲染背景和棋子
    // 绘制棋盘背景
    ctx.drawImage(boardImg, 0, 0, size, size);
    // 绘制线条
    if (useImageForLines && linesImg) {
      // 大尺寸：使用图片绘制线条
      ctx.drawImage(linesImg, 0, 0, size, size);
    } else {
      // 小尺寸：使用 Canvas 绘制线条（更清晰）
      ctx.strokeStyle = '#8B7355';
      ctx.lineWidth = Math.max(1, size * 0.01); // 根据尺寸调整线条宽度
      for (let i = 0; i < DISPLAY_SIZE; i++) {
        const pos = padding + i * gridSize;
        ctx.beginPath();
        ctx.moveTo(pos, padding);
        ctx.lineTo(pos, size - padding);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(padding, pos);
        ctx.lineTo(size - padding, pos);
        ctx.stroke();
      }
    }
  } else {
    // 降级：使用 Canvas 绘制背景和线条
    // 背景
    ctx.fillStyle = '#DCB35C';
    ctx.fillRect(0, 0, size, size);
    // 网格线
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 1;
    for (let i = 0; i < DISPLAY_SIZE; i++) {
      const pos = padding + i * gridSize;
      ctx.beginPath();
      ctx.moveTo(pos, padding);
      ctx.lineTo(pos, size - padding);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padding, pos);
      ctx.lineTo(size - padding, pos);
      ctx.stroke();
    }
    // 星位
    ctx.fillStyle = '#333';
    const stars: [number, number][] = [[15, 3], [9, 3]];
    for (const [sx, sy] of stars) {
      const localX = sx - startX;
      const localY = sy - startY;
      if (localX >= 0 && localX < DISPLAY_SIZE && localY >= 0 && localY < DISPLAY_SIZE) {
        ctx.beginPath();
        ctx.arc(padding + localX * gridSize, padding + localY * gridSize, Math.max(2, gridSize * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // 构建棋盘状态（使用 CaptureRule 处理提子）
  const boardState = buildBoardState(moves);
  // 棋子
  const stoneRadius = gridSize * 0.45;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const color = boardState[y]?.[x];
      if (!color) continue;
      const localX = x - startX;
      const localY = y - startY;
      if (localX >= 0 && localX < DISPLAY_SIZE && localY >= 0 && localY < DISPLAY_SIZE) {
        const cx = padding + localX * gridSize;
        const cy = padding + localY * gridSize;
        // 根据尺寸决定是否使用图片绘制棋子
        if (useImageForStones) {
          // 大尺寸：使用图片
          const stoneImg = color === 'black' ? blackStoneImg : whiteStoneImg;
          if (stoneImg) {
            ctx.drawImage(
              stoneImg,
              cx - stoneRadius,
              cy - stoneRadius,
              stoneRadius * 2,
              stoneRadius * 2
            );
          } else {
            // 降级：使用 Canvas 绘制
            drawStoneWithCanvas(ctx, cx, cy, stoneRadius, color);
          }
        } else {
          // 小尺寸：使用 Canvas 绘制棋子，避免失真
          drawStoneWithCanvas(ctx, cx, cy, stoneRadius, color);
        }
      }
    }
  }
  ctx.restore();
}
/**
 * 创建缩略图 canvas 元素
 */
export function createJosekiThumbnail(moves: Move[], size = 100): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  drawJosekiThumbnail(canvas, moves, size);
  return canvas;
}
