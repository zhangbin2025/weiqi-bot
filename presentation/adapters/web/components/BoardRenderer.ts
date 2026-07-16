/**
 * 棋盘渲染器 - 共享渲染逻辑
 * @module presentation/adapters/web/components/BoardRenderer
 */
import type { PlayerColor } from '../../../../domain/primitives';
import { BoardStyles } from './Board.styles';
/** AI 推荐圆圈配置 */
export interface RecommendationCircle {
  x: number;
  y: number;
  rank: number; // 1, 2, 3... 排名，1 是最好的
  pv?: string[] | undefined; // 可选的 PV line
  isActualMove?: boolean; // 是否是实战落点
}
/** 棋盘渲染器 - 静态方法，无状态 */
export class BoardRenderer {
  /**
   * 绘制棋盘背景和网格（匹配 demo 样式）
   */
  static drawBoard(
    ctx: CanvasRenderingContext2D, 
    size: number, 
    cellSize: number, 
    theme: 'classic' | 'wooden' | 'modern' = 'classic',
    showCoordinates = false
  ): void {
    const colors = BoardStyles.colors[theme];
    const canvasSize = cellSize * (size + 1);
    // 背景
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvasSize, canvasSize);
    // 网格线
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1.5; // 加粗线条以提高清晰度
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
    // 坐标标签（默认不显示）
    if (showCoordinates) {
      ctx.fillStyle = '#333';
      ctx.font = `bold ${Math.max(8, cellSize * 0.28)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < size; i++) {
        const colLabel = String.fromCharCode(65 + i + (i >= 8 ? 1 : 0));
        const x = (i + 1) * cellSize;
        const rowLabel = (size - i).toString();
        const y = (i + 1) * cellSize;
        ctx.fillText(colLabel, x, cellSize * 0.4);
        ctx.fillText(colLabel, x, canvasSize - cellSize * 0.4);
        ctx.fillText(rowLabel, cellSize * 0.4, y);
        ctx.fillText(rowLabel, canvasSize - cellSize * 0.4, y);
      }
    }
    // 绘制星位
    ctx.fillStyle = colors.star;
    const starPointsMap = BoardStyles.starPoints as Record<number, [number, number][]>;
    const stars = starPointsMap[size] ?? [];
    for (const [x, y] of stars) {
      const px = (x + 1) * cellSize;
      const py = (y + 1) * cellSize;
      const starRadius = Math.max(2, cellSize * 0.1);
      ctx.beginPath();
      ctx.arc(px, py, starRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  /**
   * 绘制棋子（渐变效果，匹配 demo）
   */
  static drawStone(
    ctx: CanvasRenderingContext2D, 
    cx: number, 
    cy: number, 
    radius: number, 
    color: PlayerColor
  ): void {
    const s = BoardStyles.stones[color];
    const gradient = ctx.createRadialGradient(
      cx - radius * 0.3, 
      cy - radius * 0.3, 
      radius * 0.1,
      cx, 
      cy, 
      radius
    );
    gradient.addColorStop(0, s.light);
    gradient.addColorStop(1, s.dark);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = s.border;
    ctx.lineWidth = 1; // 加粗边框以提高清晰度
    ctx.stroke();
  }
  /**
   * 绘制最后一手标记（黑子中间白点，白子中间黑点）
   */
  static drawLastMoveMarker(
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
  static drawMarker(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    marker: string,
    stoneColor?: PlayerColor,
    fontSize?: number,
    transparent?: boolean
  ): void {
    const size = fontSize ?? 14;
    // 空交叉点上的选点标记 - 如果 transparent 为 true，不绘制背景
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
    // 如果透明模式且有描边需求，绘制白色描边
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
   * 绘制 AI 推荐圆圈（橙色）
   * @param ctx Canvas 上下文
   * @param cx 圆心 x 坐标
   * @param cy 圆心 y 坐标
   * @param cellSize 格子大小
   * @param rank 当前排名（1 开始）
   * @param total 总共多少个圆圈（用于计算半径）
   */
  static drawRecommendationCircle(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    cellSize: number,
    rank: number,
    total: number = 5
  ): void {
    // 半径范围：最大 0.38，最小 0.22
    const maxRadius = cellSize * 0.38;
    const minRadius = cellSize * 0.22;
    
    // 计算半径：排名 1 最大，排名 last 最小
    // 如果只有 1 个圆圈，使用最大半径
    // 如果有多个圆圈，在最大和最小之间线性分布
    let radius: number;
    if (total <= 1) {
      radius = maxRadius;
    } else {
      // rank 从 1 开始，需要转换为 0 开始的索引
      const t = (rank - 1) / (total - 1);  // 0 ~ 1
      radius = maxRadius - t * (maxRadius - minRadius);
    }

    // 统一使用橙色系，通过透明度区分
    const alpha = Math.max(0.5, 1 - (rank - 1) * 0.12);
    const hue = 35; // 橙色
    const saturation = 95;
    const lightness = 50;

    // 绘制圆圈
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);

    // 填充
    ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha * 0.3})`;
    ctx.fill();

    // 描边
    ctx.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
    ctx.lineWidth = Math.max(2, cellSize * 0.06);
    ctx.stroke();

    // 绘制排名数字
    const fontSize = Math.max(10, cellSize * 0.28);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
    ctx.fillText(String(rank), cx, cy);
    ctx.restore();
  }
  /**
   * 坐标转画布位置（棋盘坐标从 1 开始，因为边缘留白）
   */
  static toCanvas(x: number, y: number, cellSize: number): { cx: number; cy: number } {
    return { cx: (x + 1) * cellSize, cy: (y + 1) * cellSize };
  }
}
