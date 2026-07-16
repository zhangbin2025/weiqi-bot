/**
 * 定式列表渲染器
 * @description 处理卡片列表的渲染、缩略图绘制、事件绑定
 */
import type { IJosekiPattern } from '../IJosekiDataProvider';
import type { JosekiFilterManager } from './JosekiFilterManager';
import type { JosekiReadMarkManager } from './JosekiReadMarkManager';
import type { JosekiWinrateHelper } from './JosekiWinrateHelper';
import { drawJosekiThumbnail } from '../../../components/JosekiThumbnail';
/** 渲染器配置 */
export interface JosekiListRendererConfig {
  filterManager: JosekiFilterManager;
  readMarkManager: JosekiReadMarkManager;
  winrateHelper: JosekiWinrateHelper;
  onExplore: (patternId: string) => void;
  onViewGame: (patternId: string) => void;
  onViewFullGame: (patternId: string) => void;
  onWinrateDetail: (patternId: string) => void;
  onCardClick: (patternId: string) => void;
}
/**
 * 列表渲染器
 */
export class JosekiListRenderer {
  constructor(private config: JosekiListRendererConfig) {}
  /** 渲染过滤标签 */
  renderFilterTabs(patterns: IJosekiPattern[], currentFilter: string): void {
    const container = document.getElementById('filter-tabs');
    if (!container) return;
    const counts = this.config.filterManager.getCounts(patterns);
    const tabs = [
      { id: 'all', label: `全部`, count: counts.all },
      { id: 'hot', label: `🔥热门`, count: counts.hot },
      { id: 'hit', label: `🎯命中`, count: counts.hit },
      { id: 'complex', label: `🧩复杂`, count: counts.complex },
    ];
    container.innerHTML = tabs.map(tab => `
      <button class="filter-tab ${currentFilter === tab.id ? 'active' : ''}" data-filter="${tab.id}">
        ${tab.label} <span class="count">${tab.count}</span>
      </button>
    `).join('');
    container.querySelectorAll('.filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = (btn as HTMLElement).dataset['filter'];
        if (filter) {
          this.config.filterManager.setFilter(filter as any);
          this.render(patterns);
        }
      });
    });
  }
  /** 渲染列表 */
  render(patterns: IJosekiPattern[]): void {
    const filtered = this.config.filterManager.filterPatterns(patterns);
    this.renderFilterTabs(patterns, this.config.filterManager.getFilter());
    const container = document.getElementById('page-root');
    if (!container) return;
    if (filtered.length === 0) {
      const filter = this.config.filterManager.getFilter();
      container.innerHTML = `
        <div class="empty-state">
          <p>${filter === 'all' ? '未发现定式规律' : '无符合条件的定式'}</p>
        </div>
      `;
      return;
    }
    const cardsHtml = filtered.map((pattern, index) => this.renderCard(pattern, index)).join('');
    container.innerHTML = `<div class="joseki-list">${cardsHtml}</div>`;
    this.renderThumbnails(filtered);
    this.bindCardEvents(filtered);
  }
  /** 渲染单个卡片 */
  private renderCard(pattern: IJosekiPattern, index: number): string {
    const isRead = this.config.readMarkManager.isRead(pattern.id);
    const tags = this.config.filterManager.getPatternTags(pattern);
    const tagsHtml = tags.map(t => {
      if (t === 'hot') return '<span class="tag tag-hot">🔥 热门</span>';
      if (t === 'hit') return '<span class="tag tag-hit">🎯 命中</span>';
      if (t === 'complex') return '<span class="tag tag-complex">🧩 复杂</span>';
      return '';
    }).join('');
    const gameInfo = pattern.gameInfo 
      ? `${pattern.gameInfo.black} vs ${pattern.gameInfo.white}`
      : '';
    let probDisplay: string;
    if (pattern.probability >= 0.01) probDisplay = (pattern.probability * 100).toFixed(1) + '%';
    else if (pattern.probability >= 0.001) probDisplay = (pattern.probability * 100).toFixed(2) + '%';
    else probDisplay = (pattern.probability * 100).toFixed(3) + '%';
    const winrate = this.config.winrateHelper.formatWinrate(pattern.winrateStats?.delta);
    return `
      <div class="joseki-card ${isRead ? 'viewed' : ''}" data-index="${index}" data-id="${pattern.id}">
        <div class="joseki-header">
          <span>${gameInfo}</span>
          <div class="joseki-tags-row">${tagsHtml}</div>
        </div>
        <div class="joseki-body">
          <div class="metrics-row">
            <canvas class="joseki-thumbnail" width="160" height="160" data-pattern-id="${pattern.id}"></canvas>
            <div class="metrics-info">
              <div class="metric-col">
                <span class="metric-value">${pattern.prefixLen}/${pattern.totalMoves}</span>
                <span class="metric-label">匹配/总手数</span>
              </div>
              <div class="metric-col">
                <span class="metric-value">${pattern.frequency}</span>
                <span class="metric-label">库出现次数</span>
              </div>
              <div class="metric-col">
                <span class="metric-value">${probDisplay}</span>
                <span class="metric-label">库出现概率</span>
              </div>
              <div class="metric-col">
                <span class="metric-value winrate-value ${winrate.className}" data-pattern-id="${pattern.id}">
                  ${winrate.display}
                </span>
                <span class="metric-label">胜率变化</span>
              </div>
            </div>
          </div>
        </div>
        <div class="joseki-footer">
          <div class="joseki-tags">
            <span class="joseki-action explore-btn" data-pattern-id="${pattern.id}">🔍 探索</span>
            ${pattern.gameInfo?.archiveId ? `<span class="joseki-action fullgame-btn" data-pattern-id="${pattern.id}">📝 对局</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }
  /** 渲染缩略图 */
  private renderThumbnails(patterns: IJosekiPattern[]): void {
    const canvases = document.querySelectorAll('canvas.joseki-thumbnail');
    canvases.forEach((canvas) => {
      const patternId = (canvas as HTMLCanvasElement).dataset['patternId'];
      if (!patternId) return;
      const pattern = patterns.find(p => p.id === patternId);
      if (!pattern) return;
      const moves = this.parseMoves(pattern.prefix, pattern.prefixLen);
      if (moves.length > 0) {
        drawJosekiThumbnail(canvas as HTMLCanvasElement, moves, 160);
      }
    });
  }
  /** 解析着法 */
  private parseMoves(prefix: string, prefixLen: number): Array<{x: number; y: number; color: 'black' | 'white'}> {
    const moves: Array<{x: number; y: number; color: 'black' | 'white'}> = [];
    const coords = prefix.trim().split(/\s+/).slice(0, prefixLen);
    coords.forEach((coord, i) => {
      if (!coord || coord.length !== 2) return;
      const x = coord.charCodeAt(0) - 97;
      const y = coord.charCodeAt(1) - 97;
      if (x >= 0 && x < 19 && y >= 0 && y < 19) {
        moves.push({ x, y, color: i % 2 === 0 ? 'black' : 'white' });
      }
    });
    return moves;
  }
  /** 绑定卡片事件 */
  private bindCardEvents(patterns: IJosekiPattern[]): void {
    document.querySelectorAll('.explore-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const patternId = (btn as HTMLElement).dataset['patternId'];
        if (patternId) this.config.onExplore(patternId);
      });
    });
    document.querySelectorAll('.fullgame-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const patternId = (btn as HTMLElement).dataset['patternId'];
        if (patternId) this.config.onViewFullGame(patternId);
      });
    });
    document.querySelectorAll('.winrate-value').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const patternId = (el as HTMLElement).dataset['patternId'];
        if (patternId) this.config.onWinrateDetail(patternId);
      });
    });
    document.querySelectorAll('.joseki-card').forEach(card => {
      card.addEventListener('click', async () => {
        const patternId = (card as HTMLElement).dataset['id'];
        if (patternId) this.config.onCardClick(patternId);
      });
    });
  }
}
