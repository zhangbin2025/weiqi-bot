/**
 * decision 标签页切换与恢复测试
 * @description 跳到其他页面再返回时（Android WebView / Electron 不支持 bfcache，
 *              整页重载），应当回到离开前所在的标签页，而不是 HTML 里写死的默认页。
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { initTabs, activateTab, TAB_STORAGE_KEY } from '../tabs';

function mountDom(): void {
  document.body.innerHTML = `
    <div class="tabs">
      <div class="tab active" data-tab="generate"></div>
      <div class="tab" data-tab="import"></div>
      <div class="tab" data-tab="history"></div>
    </div>
    <div id="generate-tab" class="tab-content active"></div>
    <div id="import-tab" class="tab-content"></div>
    <div id="history-tab" class="tab-content"></div>
  `;
}

const activeTab = () =>
  (document.querySelector('.tab.active') as HTMLElement | null)?.dataset['tab'];
const activeContent = () =>
  (document.querySelector('.tab-content.active') as HTMLElement | null)?.id;

describe('decision 标签页', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    mountDom();
  });

  it('默认停在生成页', () => {
    initTabs();
    expect(activeTab()).toBe('generate');
  });

  it('切换标签时同步内容与 class', () => {
    initTabs();
    (document.querySelector('.tab[data-tab="history"]') as HTMLElement).click();
    expect(activeTab()).toBe('history');
    expect(activeContent()).toBe('history-tab');
  });

  it('切换标签会写入 sessionStorage', () => {
    initTabs();
    (document.querySelector('.tab[data-tab="import"]') as HTMLElement).click();
    expect(sessionStorage.getItem(TAB_STORAGE_KEY)).toBe('import');
  });

  it('重载后恢复上次所在标签（不是默认页）', () => {
    initTabs();
    (document.querySelector('.tab[data-tab="history"]') as HTMLElement).click();
    // 模拟整页重载：DOM 回到默认状态，重新初始化
    mountDom();
    initTabs();
    expect(activeTab()).toBe('history');
    expect(activeContent()).toBe('history-tab');
  });

  it('存储值失效（标签已不存在）时回退到默认页', () => {
    sessionStorage.setItem(TAB_STORAGE_KEY, 'ghost');
    initTabs();
    expect(activeTab()).toBe('generate');
  });

  it('恢复时不回写存储（避免用旧值覆盖）', () => {
    sessionStorage.setItem(TAB_STORAGE_KEY, 'import');
    initTabs();
    // 恢复后用户没点任何标签，存储值应保持原样
    expect(sessionStorage.getItem(TAB_STORAGE_KEY)).toBe('import');
  });

  it('activateTab 传空值不改变当前标签', () => {
    initTabs();
    activateTab('');
    expect(activeTab()).toBe('generate');
  });
});
