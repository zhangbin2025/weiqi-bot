/**
 * @fileoverview 形势统计面板（一次性查看，非模式）
 *
 * @description 在棋盘下方显示黑白目数、提子、领先关系与贴目，带关闭按钮。
 * 三页（hm / mm / review）共用，只依赖 DOM，不依赖页面内部状态。
 *
 * 设计要点：
 * - **不是模式**：不维护开关态。显示期间被任何其它操作打断即自行关闭（调用方负责）。
 * - 关闭按钮只触发回调，面板自身不改业务状态 —— 保证与「点棋盘关闭」走同一条路径。
 * - **独占显示**：显示期间隐藏棋盘下方所有兄弟元素（工具栏、状态栏、控制栏、
 *   胜率趋势图等），关闭时按记录的原始 display 逐个恢复。
 */

import type { TerritoryStats } from '../../../../services/ai/TerritoryStats';
import { formatLead } from '../../../../services/ai/TerritoryStats';

/** 面板根元素 id */
const PANEL_ID = 'territoryStatsPanel';

export interface TerritoryPanelOptions {
  /** 关闭按钮点击回调（点 × 与「其它操作触发关闭」应走同一逻辑） */
  onClose: () => void;
}

/** 隐藏元素时记录的原始状态，用于精确恢复 */
interface HiddenEntry {
  el: HTMLElement;
  /** 元素原本的 inline display；'' 表示原本没设过（恢复时应移除该属性） */
  prev: string;
}

/** 当前被本面板隐藏的元素（模块级单例：同一时刻只会有一个形势面板） */
let hiddenEntries: HiddenEntry[] = [];

/**
 * 需要排除的元素 id
 *
 * @description 这些是覆盖层/对话框/加载层，不是"棋盘下方的内容"，绝不能隐藏：
 * - 隐藏 loadingOverlay 会让加载提示消失
 * - 隐藏 dialog 容器会让弹框打不开
 *
 * 之所以需要显式排除：hm.html 的 `.container` 未闭合，这些覆盖层在 DOM 里
 * 实际成了 board-section 的兄弟节点，会被"隐藏后续兄弟"的逻辑误伤。
 */
const SKIP_IDS = new Set([
  PANEL_ID,
  'dialogContainer',
  'loadingOverlay',
  'optionsDialog',
  'difficultyConfigDialog',
  'progressBar',
  'fileInput',
]);

/** 覆盖层类名（同样不能隐藏） */
const SKIP_CLASSES = ['dialog-overlay', 'file-input'];

/**
 * 隐藏棋盘下方的所有兄弟元素
 *
 * @description 只处理 board-section **之后**的兄弟节点 —— 棋盘本身必须保持可见。
 * 逐个记录原始 inline display，保证关闭时能原样恢复（而不是一律写回 'flex'）。
 */
function hideSiblingsAfterBoard(): void {
  restoreSiblings();
  const boardSection = document.querySelector('.board-section');
  if (!boardSection?.parentNode) return;

  let node: Element | null = boardSection.nextElementSibling;
  while (node) {
    if (node instanceof HTMLElement && shouldHide(node)) {
      hiddenEntries.push({ el: node, prev: node.style.display });
      node.style.display = 'none';
    }
    node = node.nextElementSibling;
  }
}

/** 是否该隐藏该元素：排除覆盖层与定位脱离文档流的元素 */
function shouldHide(el: HTMLElement): boolean {
  if (SKIP_IDS.has(el.id)) return false;
  if (SKIP_CLASSES.some((c) => el.classList.contains(c))) return false;
  // position:fixed/absolute 的元素是浮层，隐藏它没有意义且可能挡不住
  const pos = getComputedStyle(el).position;
  if (pos === 'fixed' || pos === 'absolute') return false;
  return true;
}

/** 恢复被隐藏的兄弟元素（精确写回原始值） */
function restoreSiblings(): void {
  for (const { el, prev } of hiddenEntries) {
    if (prev === '') {
      el.style.removeProperty('display');
    } else {
      el.style.display = prev;
    }
  }
  hiddenEntries = [];
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
    <div class="territory-panel-header">
      <div class="territory-panel-title">形势</div>
      <button class="territory-panel-close" title="关闭" aria-label="关闭形势">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="territory-stats-card">
      <div class="territory-stats-row">
        <span class="territory-stats-color"><span class="territory-dot black"></span>黑</span>
        <span class="territory-stats-num">${stats.blackTerritory.toFixed(1)} 目</span>
        <span class="territory-stats-cap">提 ${stats.capturedBlack}</span>
      </div>
      <div class="territory-stats-row">
        <span class="territory-stats-color"><span class="territory-dot white"></span>白</span>
        <span class="territory-stats-num">${stats.whiteTerritory.toFixed(1)} 目</span>
        <span class="territory-stats-cap">提 ${stats.capturedWhite}</span>
      </div>
      <div class="territory-stats-divider"></div>
      <div class="territory-stats-row territory-stats-lead">${formatLead(stats)}</div>
      <div class="territory-stats-row territory-stats-komi">黑贴 ${stats.komi} 目（目数差 ${stats.rawDiff >= 0 ? '+' : ''}${stats.rawDiff.toFixed(1)}）</div>
    </div>
  `;

  const closeBtn = panel.querySelector('.territory-panel-close');
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

  // 面板插入后再隐藏其余兄弟元素（避免把面板自己也隐藏掉）
  hideSiblingsAfterBoard();
}

/** 移除形势统计面板并恢复被隐藏的元素（幂等） */
export function hideTerritoryPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
  restoreSiblings();
}

/** 面板当前是否可见 */
export function isTerritoryPanelVisible(): boolean {
  return document.getElementById(PANEL_ID) !== null;
}

/**
 * 面板样式（注入一次）
 *
 * @description 视觉参考 review 页的选点面板：`.panel-header`（标题 + 关闭按钮）
 * 与白底卡片（1px #e0e0e0 边框、6px 圆角），保持三页观感一致。
 */
const PANEL_CSS = `
.territory-stats-panel {
  margin: 8px auto 0;
  max-width: 420px;
  padding: 8px 12px 12px;
  font-size: 13px;
  color: #333;
}
.territory-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.territory-panel-header .territory-panel-title {
  font-size: 14px;
  font-weight: bold;
  color: #333;
}
.territory-panel-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #ff6b6b;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.territory-panel-close:hover {
  background: #fff5f5;
}
.territory-stats-card {
  width: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
  background: white;
}
.territory-stats-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: white;
  border-bottom: 1px solid #f0f0f0;
  gap: 10px;
}
.territory-stats-card .territory-stats-row:last-child {
  border-bottom: none;
}
.territory-stats-color { min-width: 48px; display: inline-flex; align-items: center; gap: 5px; }
.territory-stats-num { min-width: 72px; font-weight: 600; }
.territory-stats-cap { color: #666; }
.territory-stats-divider {
  height: 1px;
  background: #e0e0e0;
  margin: 0;
}
.territory-stats-lead {
  font-weight: 600;
  color: #333;
  background: #fafbff;
}
.territory-stats-komi { color: #666; }
.territory-dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  vertical-align: middle;
}
.territory-dot.black { background: #1a1a1c; }
.territory-dot.white { background: #fcfcfa; border: 1px solid #b9b0a0; }
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
