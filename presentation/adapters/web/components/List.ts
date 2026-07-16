/**
 * Web 列表组件
 * @module presentation/adapters/web/components/List
 */
import type { IList, IListConfig, IListItem } from '../../../core/interfaces';
/**
 * Web 列表实现
 */
export class WebList implements IList {
  private items: IListItem[] = [];
  private config: IListConfig = {};
  setItems(items: IListItem[]): void {
    this.items = items;
    this.render();
  }
  addItem(item: IListItem): void {
    this.items.push(item);
    this.render();
  }
  removeItem(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.render();
  }
  clearItems(): void {
    this.items = [];
    this.render();
  }
  getSelected(): IListItem | IListItem[] | null {
    return null;
  }
  setSelected(id: string | string[]): void {
    // Web 实现需要挂载到 DOM
  }
  setConfig(config: IListConfig): void {
    this.config = config;
    this.render();
  }
  render(): void {
    // Web 实现需要挂载到 DOM
    // 这里只做基本逻辑，实际渲染由前端框架处理
  }
  destroy(): void {
    this.items = [];
    this.config = {};
  }
}