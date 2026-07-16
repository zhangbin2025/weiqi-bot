/**
 * Canvas 胜率趋势图组件 — 简洁折线图方案
 * @module presentation/adapters/web/pages/review/WinrateChart
 */

export interface ChartDataPoint {
  moveNumber: number;
  winRate: number;
  scoreLead: number;
}
export interface ChartConfig {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  colors: {
    line: string;
    currentPoint: string;
    axisLine: string;
    axisLabel: string;
    background: string;
    gridLine: string;
  };
}
const DEFAULT_CONFIG: ChartConfig = {
  width: 400,
  height: 180,  // 降低高度，从256改为180
  padding: { top: 28, right: 10, bottom: 32, left: 10 },
  colors: {
    line: '#4a90e2',  // 蓝色线条
    currentPoint: '#ff6b6b',  // 当前点红色
    axisLine: '#ddd',
    axisLabel: '#999',
    background: '#fafafa',
    gridLine: '#d5d5d5',  // 中轴线颜色稍微明显一点
  },
};
export class WinrateChart {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: ChartConfig;
  private data: ChartDataPoint[] = [];
  private currentMove = 0;
  private onClick?: (moveNumber: number) => void;
  constructor(container: HTMLElement, config?: Partial<ChartConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'winrateChart';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    container.appendChild(this.canvas);
    this.setupEventListeners();
    this.resize();
  }
  update(data: ChartDataPoint[], currentMove: number): void {
    this.data = data.filter(d => d && typeof d.moveNumber === 'number' && d.moveNumber > 0);
    this.currentMove = currentMove;
    this.render();
  }
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.config.width = rect.width;
    this.config.height = rect.height;
    this.render();
  }
  setOnClick(callback: (moveNumber: number) => void): void {
    this.onClick = callback;
  }
  private render(): void {
    const { ctx, config, data } = this;
    const { padding, colors } = config;
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, config.width, config.height);
    if (data.length === 0) {
      this.renderEmpty();
      return;
    }
    const axisY = (padding.top + (config.height - padding.bottom)) / 2;
    const maxMove = data[data.length - 1]!.moveNumber;
    const drawH = config.height - padding.top - padding.bottom;
    this.drawCurrentInfo();
    this.drawGrid(axisY, drawH);
    this.drawTrendLine(axisY, drawH, maxMove);
    this.drawCurrentPoint(axisY, drawH, maxMove);
  }
  private renderEmpty(): void {
    const { ctx, config } = this;
    ctx.fillStyle = '#999';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('分析后显示胜率趋势', config.width / 2, config.height / 2);
  }
  /** 在左上角显示当前胜率和目差 */
  private drawCurrentInfo(): void {
    const { ctx, data, currentMove } = this;
    const pt = data.find(d => d.moveNumber === currentMove);
    if (!pt) return;
    const blackWinRate = pt.winRate * 100;
    const scoreLead = pt.scoreLead;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '12px -apple-system, sans-serif';  // 不标粗，统一字体大小
    ctx.fillStyle = '#666';  // 统一颜色
    // 显示黑方胜率
    ctx.fillText(`黑 ${blackWinRate.toFixed(1)}%`, 6, 6);
    // 显示目差
    const scoreText = scoreLead >= 0 ? `+${scoreLead.toFixed(1)}目` : `${scoreLead.toFixed(1)}目`;
    ctx.fillText(scoreText, 80, 6);
  }
  /** 绘制网格线 */
  private drawGrid(axisY: number, drawH: number): void {
    const { ctx, config } = this;
    const { colors } = config;
    // 水平网格线（50%线）
    ctx.strokeStyle = colors.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, axisY);
    ctx.lineTo(config.width, axisY);
    ctx.stroke();
    // 不显示50%标签
  }
  /** 绘制胜率趋势线 */
  private drawTrendLine(axisY: number, drawH: number, maxMove: number): void {
    const { ctx, config, data } = this;
    const maxBarH = drawH / 2;
    // 启用抗锯齿
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 绘制趋势线（精细的折线）
    ctx.strokeStyle = config.colors.line;
    ctx.lineWidth = 1.5;  // 精细的线条
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let firstPoint = true;
    for (let i = 0; i < data.length; i++) {
      const pt = data[i]!;
      const x = (pt.moveNumber / maxMove) * config.width;
      const deviation = pt.winRate - 0.5;
      const y = axisY - deviation * maxBarH * 2;
      if (firstPoint) {
        ctx.moveTo(x, y);
        firstPoint = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  /** 绘制当前手竖线 */
  private drawCurrentPoint(axisY: number, drawH: number, maxMove: number): void {
    const { ctx, config, data, currentMove } = this;
    const colors = config.colors;
    const pt = data.find(d => d.moveNumber === currentMove);
    if (!pt) return;
    const x = (currentMove / maxMove) * config.width;
    // 画竖线，不画圆点
    ctx.strokeStyle = colors.currentPoint;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, config.padding.top);
    ctx.lineTo(x, config.height - config.padding.bottom);
    ctx.stroke();
  }
  private setupEventListeners(): void {
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    window.addEventListener('resize', () => this.resize());
  }
  private handleClick(event: MouseEvent): void {
    if (!this.onClick || this.data.length === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const maxMove = this.data[this.data.length - 1]!.moveNumber;
    const moveNumber = Math.round(ratio * maxMove);
    const clamped = Math.max(1, Math.min(maxMove, moveNumber));
    this.onClick(clamped);
  }
  destroy(): void {
    window.removeEventListener('resize', () => this.resize());
    this.canvas.remove();
  }
}
