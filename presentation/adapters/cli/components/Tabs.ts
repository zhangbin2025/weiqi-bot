/**
 * 终端标签组件
 * @description 实现 ITabs 接口，在终端环境下切换标签
 * @module presentation/adapters/cli/components/Tabs
 */
import type { ITabs, ITabsConfig, TabItem } from '../../../core/interfaces';
/**
 * 终端标签组件
 * 标签切换通过命令控制，不渲染视觉元素
 */
export class TerminalTabs implements ITabs {
  private items: TabItem[] = [];
  private activeId = '';
  private changeCallback?: (id: string) => void;
  getActiveId(): string {
    return this.activeId;
  }
  setConfig(config: ITabsConfig): void {
    this.items = config.items;
    this.activeId = config.activeId ?? '';
  }
  setActiveId(id: string): void {
    this.activeId = id;
    this.changeCallback?.(id);
  }
  addTab(item: TabItem): void {
    this.items.push(item);
  }
  removeTab(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
  }
  updateTab(id: string, updates: Partial<TabItem>): void {
    const index = this.items.findIndex((item) => item.id === id);
    if (index !== -1) {
      this.items[index] = { ...this.items[index]!, ...updates };
    }
  }
  onChange(callback: (id: string) => void): void {
    this.changeCallback = callback;
  }
  render(): void {
    // 不渲染视觉元素，通过命令切换
  }
  destroy(): void {
    this.items = [];
    this.activeId = '';
    // Note: callback intentionally not cleared to avoid exactOptionalPropertyTypes issue
  }
}
