/**
 * 候选着法面板组件
 * @module presentation/adapters/web/pages/review/CandidatesPanel
 */
/** 候选着法数据 */
export interface CandidateMove {
  x: number;
  y: number;
  winRate: number;
  scoreLead: number;
  visits: number;
  isCurrentMove: boolean;
  pv?: string[];  // PV line（后续变化）
}
/**
 * 候选着法面板
 * 显示 AI 推荐的候选着法列表
 */
export class CandidatesPanel {
  private container: HTMLElement;
  private candidates: CandidateMove[] = [];
  private onSelect?: (x: number, y: number, pv?: string[]) => void;
  constructor(container: HTMLElement) {
    this.container = container;
    this.setupEventListeners();
  }
  /**
   * 更新候选着法列表
   */
  update(candidates: CandidateMove[]): void {
    this.candidates = candidates;
    this.render();
  }
  /**
   * 设置选择回调
   */
  setOnSelect(callback: (x: number, y: number, pv?: string[]) => void): void {
    this.onSelect = callback;
  }
  /**
   * 渲染面板
   */
  private render(): void {
    if (this.candidates.length === 0) {
      this.container.innerHTML = '<div class="no-candidates">点击"分析局面"查看 AI 推荐</div>';
      return;
    }
    const html = this.candidates.map((c, i) => this.renderCandidate(c, i)).join('');
    this.container.innerHTML = html;
  }
  /**
   * 渲染单个候选着法
   */
  private renderCandidate(candidate: CandidateMove, index: number): string {
    const coord = this.coordToString(candidate.x, candidate.y);
    const winRatePercent = (candidate.winRate * 100).toFixed(1);
    const scoreLeadValue = candidate.scoreLead;
    const scoreLead = scoreLeadValue.toFixed(1);
    const className = candidate.isCurrentMove ? 'candidate current' : 'candidate';
    // PV line 显示
    const pvHtml = candidate.pv && candidate.pv.length > 0
      ? `<div class="pv-line">${candidate.pv.join(' → ')}</div>`
      : '';
    return `
      <div class="${className}" data-x="${candidate.x}" data-y="${candidate.y}" data-pv="${candidate.pv?.join(',') || ''}">
        <div class="candidate-main">
          <span class="rank">${index + 1}.</span>
          <span class="coord">${coord}</span>
          <span class="winrate">${winRatePercent}%</span>
          <span class="score">${scoreLeadValue > 0 ? '+' : ''}${scoreLead}</span>
          <span class="visits">(${candidate.visits})</span>
        </div>
        ${pvHtml}
      </div>
    `;
  }
  /**
   * 坐标转字符串
   */
  private coordToString(x: number, y: number): string {
    const letter = String.fromCharCode(97 + x);
    const number = 19 - y;
    return `${letter}${number}`;
  }
  /**
   * 设置事件监听
   */
  private setupEventListeners(): void {
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const candidate = target.closest('.candidate') as HTMLElement;
      if (candidate) {
        const x = parseInt(candidate.dataset['x']!, 10);
        const y = parseInt(candidate.dataset['y']!, 10);
        const pvStr = candidate.dataset['pv'];
        const pv = pvStr ? pvStr.split(',').filter(s => s.length > 0) : undefined;
        this.onSelect?.(x, y, pv);
      }
    });
  }
  /**
   * 销毁组件
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
