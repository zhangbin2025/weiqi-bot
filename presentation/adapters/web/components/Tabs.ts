/**
 * Web Tabs 组件 - 胶囊式样式
 */
import type { ITabs, ITabsConfig, TabItem } from '../../../core/interfaces';
export class WebTabs implements ITabs {
  private element: HTMLElement;
  private tabList: HTMLElement;
  private tabs: Map<string, TabItem> = new Map();
  private tabOrder: string[] = [];
  private activeId: string = '';
  private changeCallback?: (id: string) => void;
  private mounted = false;
  private container: HTMLElement | undefined;
  constructor(container?: HTMLElement) {
    this.container = container;
    this.element = document.createElement('div');
    this.element.className = 'web-tabs';
    this.tabList = document.createElement('div');
    this.tabList.className = 'web-tabs__list';
    this.tabList.style.cssText = `
      display: flex;
      background: rgba(255,255,255,0.15);
      border-radius: 12px;
      padding: 4px;
      margin-bottom: 16px;
    `;
    this.element.appendChild(this.tabList);
    if (container) {
      container.appendChild(this.element);
      this.mounted = true;
    }
  }
  getActiveId(): string { return this.activeId; }
  setActiveId(id: string): void {
    if (this.tabs.has(id)) {
      this.activeId = id;
      this.renderTabs();
    }
  }
  addTab(item: TabItem): void {
    this.tabs.set(item.id, item);
    this.tabOrder.push(item.id);
    if (!this.activeId) this.activeId = item.id;
    this.renderTabs();
  }
  removeTab(id: string): void {
    this.tabs.delete(id);
    const idx = this.tabOrder.indexOf(id);
    if (idx > -1) this.tabOrder.splice(idx, 1);
    if (this.activeId === id && this.tabOrder.length > 0) this.activeId = this.tabOrder[0]!;
    this.renderTabs();
  }
  updateTab(id: string, updates: Partial<TabItem>): void {
    const tab = this.tabs.get(id);
    if (tab) { this.tabs.set(id, { ...tab, ...updates }); this.renderTabs(); }
  }
  setConfig(config: ITabsConfig): void {
    this.tabs.clear();
    this.tabOrder = [];
    for (const item of config.items) {
      this.tabs.set(item.id, item);
      this.tabOrder.push(item.id);
    }
    if (config.activeId && this.tabs.has(config.activeId)) this.activeId = config.activeId;
    else if (this.tabOrder.length > 0) this.activeId = this.tabOrder[0]!;
    this.renderTabs();
  }
  /** 挂载到指定容器（Web 实现专用） */
  mountTo(container: HTMLElement): void {
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    container.appendChild(this.element);
    this.mounted = true;
  }
  onChange(callback: (id: string) => void): void { this.changeCallback = callback; }
  private renderTabs(): void {
    this.tabList.innerHTML = '';
    for (const id of this.tabOrder) {
      const tab = this.tabs.get(id);
      if (!tab) continue;
      const tabItem = document.createElement('div');
      tabItem.className = 'web-tabs__item';
      tabItem.textContent = tab.label;
      const isActive = id === this.activeId;
      tabItem.style.cssText = `
        flex: 1; padding: 12px; text-align: center; cursor: pointer;
        border-radius: 10px; transition: all 0.3s; font-size: 15px;
        display: flex; align-items: center; justify-content: center; gap: 6px;
        ${isActive
          ? 'background: white; color: #667eea; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.15);'
          : 'color: rgba(255,255,255,0.8);'}
      `;
      if (!tab.disabled) {
        tabItem.addEventListener('click', () => {
          this.activeId = id;
          this.renderTabs();
          this.changeCallback?.(id);
        });
      }
      this.tabList.appendChild(tabItem);
    }
  }
  render(): void {
    if (!this.mounted) {
      const target = this.container ?? document.getElementById('page-root') ?? document.body;
      if (!target.contains(this.element)) {
        target.appendChild(this.element);
      }
      this.mounted = true;
    }
    this.renderTabs();
  }
  destroy(): void { this.element.remove(); }
}
