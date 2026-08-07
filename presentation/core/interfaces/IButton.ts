/**
 * 按钮接口
 * @module presentation/core/interfaces/IButton
 */
/**
 * 按钮变体类型
 */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
/**
 * 按钮大小
 */
export type ButtonSize = 'sm' | 'md' | 'lg';
/**
 * 按钮配置
 */
export interface IButtonConfig {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
}
/**
 * 按钮接口
 * 定义按钮组件的抽象接口
 */
export interface IButton {
  /** 设置文本 */
  setText(text: string): void;
  /** 设置配置 */
  setConfig(config: IButtonConfig): void;
  /** 设置点击事件 */
  onClick(callback: () => void): void;
  /** 设置禁用状态 */
  setDisabled(disabled: boolean): void;
  /** 设置加载状态 */
  setLoading(loading: boolean): void;
  /** 渲染 */
  render(): void;
  /** 销毁 */
  destroy(): void;
}
