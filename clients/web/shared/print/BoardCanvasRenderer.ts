/**
 * 棋盘 Canvas 渲染器（公共模块）
 * @description 在 canvas 上渲染围棋棋盘局面，纸质打印风格，供 replay 和 decision 打印共用
 */

export interface StoneData {
  x: number;
  y: number;
  color: 'black' | 'white';
}

export interface RenderOptions {
  /** 最后一手棋位置（用于标记） */
  lastMove?: { x: number; y: number; color: 'black' | 'white' };
  /** 标记点列表（字母标记，用于选点题） */
  labels?: Array<{ x: number; y: number; letter: string }>;
  /** 棋盘路数，默认 19 */
  size?: number;
}

export class BoardCanvasRenderer {
  /**
   * 在 canvas 上渲染棋盘局面（纸质打印风格）
   */
  static render(canvas: HTMLCanvasElement, stones: StoneData[], options?: RenderOptions): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = options?.size ?? 19;
    const canvasSize = canvas.width;

    const padding = canvasSize * 0.05;
    const gridSize = (canvasSize - padding * 2) / (size - 1);

    // 清空画布（白色背景）
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // 绘制网格线
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.0;
    for (let i = 0; i < size; i++) {
      const pos = padding + i * gridSize;
      ctx.beginPath();
      ctx.moveTo(pos, padding);
      ctx.lineTo(pos, canvasSize - padding);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padding, pos);
      ctx.lineTo(canvasSize - padding, pos);
      ctx.stroke();
    }

    // 绘制星位
    ctx.fillStyle = '#000';
    const starPoints: [number, number][] = size === 19
      ? [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]]
      : size === 13
        ? [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]]
        : [[3, 3], [3, 6], [6, 3], [6, 6]];

    for (const [sx, sy] of starPoints) {
      const x = padding + sx * gridSize;
      const y = padding + sy * gridSize;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 绘制棋子（纸质风格：黑棋纯黑实心，白棋白底黑边）
    const r = gridSize * 0.45;
    for (const stone of stones) {
      const x = padding + stone.x * gridSize;
      const y = padding + stone.y * gridSize;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);

      if (stone.color === 'black') {
        ctx.fillStyle = '#000';
        ctx.fill();
      } else {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }

    // 最后一手标记（中心点：黑棋上画白点，白棋上画黑点）
    if (options?.lastMove) {
      const { x: lx, y: ly, color } = options.lastMove;
      const cx = padding + lx * gridSize;
      const cy = padding + ly * gridSize;
      ctx.fillStyle = color === 'black' ? '#fff' : '#000';
      ctx.beginPath();
      ctx.arc(cx, cy, gridSize * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // 字母标记（选点题用）
    if (options?.labels && options.labels.length > 0) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.font = `bold ${gridSize * 0.85}px Arial`;
      for (const label of options.labels) {
        const x = padding + label.x * gridSize;
        const y = padding + label.y * gridSize;
        ctx.fillText(label.letter, x, y);
      }
    }
  }
}
