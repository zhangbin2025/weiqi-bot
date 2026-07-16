/**
 * 对话框接口
 * @module presentation/core/interfaces/IDialog
 */
/**
 * 对话框类型
 */
export type DialogType = 'alert' | 'confirm' | 'prompt' | 'custom';
/**
 * 输入类型
 */
export type DialogInputType = 'text' | 'number' | 'password';
/**
 * 对话框配置
 */
export interface IDialogConfig {
  type?: DialogType;
  title?: string;
  content?: string;
  confirmText?: string;
  cancelText?: string;
  inputType?: DialogInputType;
  inputPlaceholder?: string;
  inputDefaultValue?: string;
  buttons?: Array<{ id: string; text: string }>;
}
/**
 * 对话框结果
 */
export type DialogResult = boolean | string | null;
/**
 * 对话框接口
 * 定义对话框的抽象接口
 */
export interface IDialog {
  /** 显示对话框 */
  show(config: IDialogConfig): Promise<DialogResult>;
  /** 关闭对话框 */
  close(): void;
  /** 设置内容 */
  setContent(content: string): void;
  /** 销毁 */
  destroy(): void;
}
