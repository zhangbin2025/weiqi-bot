/**
 * @fileoverview 形势统计面板（一次性查看，非模式）
 *
 * @description 在棋盘下方以 2×2 紧凑网格显示黑白目数/提子、领先与贴目。
 * 视觉与宽度对齐 review 页的试下面板（`.special-controls-bar`）：
 * 满宽、`#f0f4ff` 背景、`8px 12px` 内边距、`1px solid #e8e8e8` 下边框。
 *
 * 布局（两行两列）：
 * ```
 * 形势                      ✕
 * ●黑 42.5目 提3    黑领先 7.5目
 * ○白 35.0目 提5    黑贴 6.5目
 * ```
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
    <div class="territory-grid">
      <div class="territory-cell territory-cell-side">
        <span class="territory-dot black"></span><span class="territory-side-label">黑</span>
      </div>
      <div class="territory-cell territory-cell-num">${stats.blackTerritory.toFixed(1)} 目</div>
      <div class="territory-cell territory-cell-cap">提 ${stats.capturedBlack}</div>
      <div class="territory-cell territory-cell-lead" title="目数差 ${stats.rawDiff >= 0 ? '+' : ''}${stats.rawDiff.toFixed(1)}">${formatLead(stats)}</div>

      <div class="territory-cell territory-cell-side">
        <span class="territory-dot white"></span><span class="territory-side-label">白</span>
      </div>
      <div class="territory-cell territory-cell-num">${stats.whiteTerritory.toFixed(1)} 目</div>
      <div class="territory-cell territory-cell-cap">提 ${stats.capturedWhite}</div>
      <div class="territory-cell territory-cell-komi">黑贴 ${stats.komi} 目</div>
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
 * @description 对齐 review 试下面板 `.special-controls-bar`：
 * 满宽、`#f0f4ff` 背景、`8px 12px` 内边距、`1px solid #e8e8e8` 下边框。
 * 内容区为两行两列紧凑网格：左列黑白目数/提子，右列领先与贴目。
 */
const PANEL_CSS = `
.territory-stats-panel {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 14px;
  background: #f0f4ff;
  border-bottom: 1px solid #e8e8e8;
  font-size: 13px;
  line-height: 1.5;
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
  line-height: normal;
}
.territory-panel-close {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
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
.territory-grid {
  display: grid;
  grid-template-columns: auto auto auto 1fr;
  align-items: center;
  gap: 6px 14px;
}
.territory-cell-side {
  min-width: 52px;
}
.territory-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.territory-side-label { font-weight: 600; }
.territory-cell-num {
  font-weight: 600;
  justify-self: end;
  font-variant-numeric: tabular-nums;
}
.territory-cell-cap {
  color: #666;
  justify-self: end;
  font-variant-numeric: tabular-nums;
}
.territory-cell-lead {
  font-weight: 600;
  color: #333;
  justify-self: end;
}
.territory-cell-komi {
  color: #666;
  justify-self: end;
}
.territory-dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex: none;
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
