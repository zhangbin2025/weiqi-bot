/**
 * 标签切换接口
 * @module presentation/core/interfaces/ITabs
 */
/**
 * 标签项
 */
export interface TabItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  /** 显示数量角标 */
  count?: number;
}
/**
 * 标签配置
 */
export interface ITabsConfig {
  items: TabItem[];
  activeId?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  variant?: 'line' | 'pill' | 'card';
}
/**
 * 标签切换接口
 * 定义标签导航的抽象接口
 */
export interface ITabs {
  /** 获取当前激活标签 */
  getActiveId(): string;
  /** 设置激活标签 */
  setActiveId(id: string): void;
  /** 添加标签 */
  addTab(item: TabItem): void;
  /** 移除标签 */
  removeTab(id: string): void;
  /** 更新标签 */
  updateTab(id: string, updates: Partial<TabItem>): void;
  /** 设置配置 */
  setConfig(config: ITabsConfig): void;
  /** 切换事件 */
  onChange(callback: (id: string) => void): void;
  /** 渲染 */
  render(): void;
  /** 挂载到指定容器（Web 实现专用，可选） */
  mountTo?(container: HTMLElement): void;
  /** 销毁 */
  destroy(): void;
}
