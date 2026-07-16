/**
 * 列表接口
 * @module presentation/core/interfaces/IList
 */
/**
 * 列表项
 */
export interface IListItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  disabled?: boolean;
  isHeader?: boolean;
  onClick?: () => void;
}
/**
 * 列表配置
 */
export interface IListConfig {
  items?: IListItem[];
  selectable?: boolean;
  multiSelect?: boolean;
  searchable?: boolean;
  emptyMessage?: string;
}
/**
 * 列表接口
 * 定义列表组件的抽象接口
 */
export interface IList {
  /** 设置项目 */
  setItems(items: IListItem[]): void;
  /** 添加项目 */
  addItem(item: IListItem): void;
  /** 移除项目 */
  removeItem(id: string): void;
  /** 清空项目 */
  clearItems(): void;
  /** 获取选中项 */
  getSelected(): IListItem | IListItem[] | null;
  /** 设置选中项 */
  setSelected(id: string | string[]): void;
  /** 设置配置 */
  setConfig(config: IListConfig): void;
  /** 渲染 */
  render(): void;
  /** 销毁 */
  destroy(): void;
}