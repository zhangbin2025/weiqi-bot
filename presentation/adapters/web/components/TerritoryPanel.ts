/**
 * @fileoverview 形势统计面板（一次性查看，非模式）
 *
 * @description 在棋盘下方显示黑白目数、提子、领先关系与贴目，带关闭按钮。
 * 三页（hm / mm / review）共用，只依赖 DOM，不依赖页面内部状态。
 *
 * 设计要点：
 * - **不是模式**：不维护开关态。显示期间被任何其它操作打断即自行关闭（调用方负责）。
 * - 关闭按钮只触发回调，面板自身不改业务状态 —— 保证与「点棋盘关闭」走同一条路径。
 */

import type { TerritoryStats } from '../../../../services/ai/TerritoryStats';
import { formatLead } from '../../../../services/ai/TerritoryStats';

/** 面板根元素 id */
const PANEL_ID = 'territoryStatsPanel';

export interface TerritoryPanelOptions {
  /** 关闭按钮点击回调（点 × 与「其它操作触发关闭」应走同一逻辑） */
  onClose: () => void;
}

/**
 * 显示形势统计面板
 *
 * @description 幂等：重复调用会先移除旧面板再插入，不会叠加。
 * 插入位置：`board-section` 之后（棋盘下方）；找不到则 fallback 到 body 末尾。
 */
export function showTerritoryPanel(stats: TerritoryStats, opts: TerritoryPanelOptions): void {
  hideTerritoryPanel();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'territory-stats-panel';
  panel.innerHTML = `
    <button class="territory-stats-close" title="关闭" aria-label="关闭形势统计">×</button>
    <div class="territory-stats-row">
      <span class="territory-stats-color"><span class="stone-dot black"></span>黑</span>
      <span class="territory-stats-num">${stats.blackTerritory.toFixed(1)} 目</span>
      <span class="territory-stats-cap">提 ${stats.capturedBlack}</span>
    </div>
    <div class="territory-stats-row">
      <span class="territory-stats-color"><span class="stone-dot white"></span>白</span>
      <span class="territory-stats-num">${stats.whiteTerritory.toFixed(1)} 目</span>
      <span class="territory-stats-cap">提 ${stats.capturedWhite}</span>
    </div>
    <div class="territory-stats-divider"></div>
    <div class="territory-stats-row territory-stats-lead">${formatLead(stats)}</div>
    <div class="territory-stats-row territory-stats-komi">黑贴 ${stats.komi} 目（目数差 ${stats.rawDiff >= 0 ? '+' : ''}${stats.rawDiff.toFixed(1)}）</div>
  `;

  const closeBtn = panel.querySelector('.territory-stats-close');
  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onClose();
  });

  const boardSection = document.querySelector('.board-section');
  if (boardSection?.parentNode) {
    boardSection.parentNode.insertBefore(panel, boardSection.nextSibling);
  } else {
    document.body.appendChild(panel);
  }
}

/** 移除形势统计面板（幂等） */
export function hideTerritoryPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

/** 面板当前是否可见 */
export function isTerritoryPanelVisible(): boolean {
  return document.getElementById(PANEL_ID) !== null;
}

/**
 * 面板样式（注入一次）
 *
 * @description 样式放在 JS 里是为了让三页共用同一份定义，
 * 不必改三个 HTML；已在页面 CSS 中定义时可跳过。
 */
const PANEL_CSS = `
.territory-stats-panel {
  margin: 10px auto 0;
  max-width: 420px;
  padding: 10px 12px;
  background: #fffdf8;
  border: 1px solid #ddd5c7;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  font-size: 14px;
  line-height: 1.9;
  position: relative;
}
.territory-stats-close {
  position: absolute;
  top: 4px;
  right: 6px;
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: #8a7f6f;
  cursor: pointer;
  padding: 2px 6px;
}
.territory-stats-close:hover { color: #333; }
.territory-stats-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.territory-stats-color { min-width: 52px; display: inline-flex; align-items: center; gap: 5px; }
.territory-stats-num { min-width: 76px; font-weight: 600; }
.territory-stats-cap { color: #6b6357; }
.territory-stats-divider {
  height: 1px;
  background: #e8e0d2;
  margin: 6px 0;
}
.territory-stats-lead { font-weight: 600; color: #2b2b2b; }
.territory-stats-komi { color: #6b6357; font-size: 13px; }
.stone-dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  vertical-align: middle;
}
.stone-dot.black { background: #1a1a1c; }
.stone-dot.white { background: #fcfcfa; border: 1px solid #b9b0a0; }
`;

let cssInjected = false;
/** 注入面板样式（幂等） */
export function injectTerritoryPanelCss(): void {
  if (cssInjected) return;
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}
