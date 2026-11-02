/**
 * @fileoverview 形势面板的 DOM 行为测试
 *
 * @description 重点验证「独占显示」：显示期间隐藏棋盘下方的所有内容元素，
 * 关闭时精确恢复（含原本 inline 就是 none 的元素），且覆盖层不被误伤。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  showTerritoryPanel,
  hideTerritoryPanel,
  isTerritoryPanelVisible,
  injectTerritoryPanelCss,
} from '../TerritoryPanel';

/** 造一个 hm/review 风格的页面骨架 */
function setupPage(opts: { hiddenStatus?: boolean } = {}): void {
  document.body.innerHTML = `
    <div class="container">
      <div class="board-section"><div id="page-root"></div></div>
      <div class="toolbar" id="toolbar">工具栏</div>
      <div class="status-bar" id="gameStatus"${opts.hiddenStatus ? ' style="display:none;"' : ''}>状态栏</div>
      <!-- hm.html 的 container 未闭合，这些覆盖层实际成了 board-section 的兄弟 -->
      <div id="dialogContainer"></div>
      <div id="loadingOverlay" style="display:none;">加载中</div>
      <div class="dialog-overlay" id="optionsDialog" style="display:none;">弹框</div>
    </div>
  `;
}

const stats = {
  blackTerritory: 50,
  whiteTerritory: 40,
  capturedBlack: 3,
  capturedWhite: 5,
  komi: 7.5,
  rawDiff: 10,
  lead: 2.5,
};

describe('TerritoryPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    injectTerritoryPanelCss();
  });

  afterEach(() => {
    hideTerritoryPanel();
    document.body.innerHTML = '';
  });

  it('显示后棋盘下方的内容元素被隐藏', () => {
    setupPage();
    showTerritoryPanel(stats, { onClose: () => {} });

    expect(isTerritoryPanelVisible()).toBe(true);
    expect((document.getElementById('toolbar') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('gameStatus') as HTMLElement).style.display).toBe('none');
  });

  it('棋盘本身保持可见', () => {
    setupPage();
    showTerritoryPanel(stats, { onClose: () => {} });
    const board = document.querySelector('.board-section') as HTMLElement;
    expect(board.style.display).not.toBe('none');
  });

  it('覆盖层（dialog/loading/弹框）不被隐藏', () => {
    setupPage();
    showTerritoryPanel(stats, { onClose: () => {} });

    // loadingOverlay 原本就是 none，应保持不变（值仍是 none，但不是我们设的）
    expect((document.getElementById('dialogContainer') as HTMLElement).style.display).toBe('');
    expect((document.getElementById('loadingOverlay') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('optionsDialog') as HTMLElement).style.display).toBe('none');
  });

  it('关闭后恢复所有被隐藏元素的原始 display', () => {
    setupPage();
    showTerritoryPanel(stats, { onClose: () => {} });
    hideTerritoryPanel();

    expect(isTerritoryPanelVisible()).toBe(false);
    // toolbar 原本没设 inline display → 恢复时应移除该属性
    expect((document.getElementById('toolbar') as HTMLElement).style.display).toBe('');
    expect((document.getElementById('gameStatus') as HTMLElement).style.display).toBe('');
  });

  it('原本 inline 就是 none 的元素，关闭后仍是 none（不被误恢复成可见）', () => {
    setupPage({ hiddenStatus: true });
    showTerritoryPanel(stats, { onClose: () => {} });
    // 隐藏期间是 none
    expect((document.getElementById('gameStatus') as HTMLElement).style.display).toBe('none');
    hideTerritoryPanel();
    // 恢复后仍应是 none —— 这是"精确恢复"而非"一律写回空"的关键
    expect((document.getElementById('gameStatus') as HTMLElement).style.display).toBe('none');
  });

  it('重复显示不会叠加面板，也不会重复隐藏', () => {
    setupPage();
    showTerritoryPanel(stats, { onClose: () => {} });
    showTerritoryPanel(stats, { onClose: () => {} });

    expect(document.querySelectorAll('#territoryStatsPanel').length).toBe(1);

    hideTerritoryPanel();
    expect((document.getElementById('toolbar') as HTMLElement).style.display).toBe('');
  });

  it('关闭按钮触发回调', () => {
    setupPage();
    let closed = false;
    showTerritoryPanel(stats, { onClose: () => { closed = true; } });

    const btn = document.querySelector('.territory-panel-close') as HTMLElement;
    btn.click();
    expect(closed).toBe(true);
  });

  it('幂等：未显示时调用 hide 不报错', () => {
    expect(() => hideTerritoryPanel()).not.toThrow();
    expect(() => hideTerritoryPanel()).not.toThrow();
  });

  it('面板内容包含目数、提子、领先与贴目', () => {
    setupPage();
    showTerritoryPanel(stats, { onClose: () => {} });
    const text = document.getElementById('territoryStatsPanel')!.textContent ?? '';

    expect(text).toContain('50.0 目');
    expect(text).toContain('40.0 目');
    expect(text).toContain('提 3');
    expect(text).toContain('提 5');
    expect(text).toContain('7.5');
  });
});
