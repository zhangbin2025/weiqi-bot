/**
 * 输入框接口
 * @module presentation/core/interfaces/IInput
 */
/**
 * 输入框类型
 */
export type InputType = 'text' | 'password' | 'number' | 'email' | 'search' | 'textarea';
/**
 * 输入框状态
 */
export type InputState = 'default' | 'success' | 'warning' | 'error';
/**
 * 输入框配置
 */
export interface IInputConfig {
  type?: InputType;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  state?: InputState;
  clearable?: boolean;
}
/**
 * 输入框接口
 * 定义输入框组件的抽象接口
 */
export interface IInput {
  /** 获取值 */
  getValue(): string;
  /** 设置值 */
  setValue(value: string): void;
  /** 清空 */
  clear(): void;
  /** 设置配置 */
  setConfig(config: IInputConfig): void;
  /** 设置状态 */
  setState(state: InputState): void;
  /** 设置禁用 */
  setDisabled(disabled: boolean): void;
  /** 聚焦 */
  focus(): void;
  /** 失焦 */
  blur(): void;
  /** 值变更事件 */
  onChange(callback: (value: string) => void): void;
  /** 回车事件 */
  onEnter(callback: (value: string) => void): void;
  /** 从剪贴板粘贴 */
  pasteFromClipboard(): Promise<boolean>;
  /** 获取容器元素（供外部布局使用） */
  getContainer(): HTMLElement | undefined;
  /** 渲染 */
  render(): void;
  /** 销毁 */
  destroy(): void;
}
