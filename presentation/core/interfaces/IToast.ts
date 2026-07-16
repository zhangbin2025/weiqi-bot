/**
 * 提示消息接口
 * @module presentation/core/interfaces/IToast
 */
/**
 * 提示消息类型
 */
export type ToastType = 'info' | 'success' | 'warning' | 'error';
/**
 * 提示消息配置
 */
export interface IToastConfig {
  type?: ToastType | undefined;
  duration?: number | undefined;
  position?: 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | undefined;
  closable?: boolean | undefined;
}
/**
 * 提示消息接口
 * 定义短暂提示消息的抽象接口
 */
export interface IToast {
  /** 显示提示 */
  show(message: string, config?: IToastConfig): void;
  /** 成功提示 */
  success(message: string, duration?: number): void;
  /** 错误提示 */
  error(message: string, duration?: number): void;
  /** 警告提示 */
  warning(message: string, duration?: number): void;
  /** 信息提示 */
  info(message: string, duration?: number): void;
  /** 关闭所有 */
  closeAll(): void;
  /** 销毁 */
  destroy(): void;
}
