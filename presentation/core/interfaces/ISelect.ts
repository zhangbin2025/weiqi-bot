/**
 * 选择器接口
 * @module presentation/core/interfaces/ISelect
 */
/**
 * 选择器选项
 */
export interface ISelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
/**
 * 选择器配置
 */
export interface ISelectConfig {
  options?: ISelectOption[];
  value?: string;
  placeholder?: string;
  disabled?: boolean;
}
/**
 * 选择器接口
 * 定义下拉选择器的抽象接口
 */
export interface ISelect {
  /** 设置选项 */
  setOptions(options: ISelectOption[]): void;
  /** 设置值 */
  setValue(value: string): void;
  /** 获取值 */
  getValue(): string | undefined;
  /** 设置配置 */
  setConfig(config: ISelectConfig): void;
  /** 设置变更事件 */
  onChange(callback: (value: string) => void): void;
  /** 渲染 */
  render(): void;
  /** 挂载到容器 */
  mountTo?(container: unknown): void;
  /** 设置嵌入深色背景的样式 */
  setTransparentStyle?(): void;
  /** 销毁 */
  destroy(): void;
}
