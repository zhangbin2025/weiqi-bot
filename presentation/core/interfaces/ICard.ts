/**
 * 卡片接口
 * @module presentation/core/interfaces/ICard
 */
/**
 * 卡片配置
 */
export interface ICardConfig {
  title?: string;
  subtitle?: string;
  elevation?: 'none' | 'sm' | 'md' | 'lg';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
  clickable?: boolean;
  position?: 'normal' | 'fixed';
  fullScreen?: boolean;
}
/**
 * 卡片接口
 * 定义卡片容器的抽象接口
 */
export interface ICard {
  /** 设置标题 */
  setTitle(title: string): void;
  /** 设置副标题 */
  setSubtitle(subtitle: string): void;
  /** 设置内容 */
  setContent(content: string): void;
  /** 设置配置 */
  setConfig(config: ICardConfig): void;
  /** 设置点击事件 */
  onClick(callback: () => void): void;
  /** 设置动作事件（卡片内容区的交互，如点击历史条目） */
  onAction(callback: (action: string, data?: Record<string, string>) => void): void;
  /** 设置可见性 */
  setVisible(visible: boolean): void;
  /** 渲染 */
  render(): void;
  /** 获取内容区容器（用于嵌入子组件） */
  getContainer?(): unknown;
  /** 确保当前卡片在目标卡片之前渲染 */
  ensureBefore?(target: ICard): void;
  /** 销毁 */
  destroy(): void;
}
