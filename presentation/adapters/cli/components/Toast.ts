/**
 * 终端提示组件
 * @description 实现 IToast 接口，输出彩色 ANSI 提示到 stdout
 * @module presentation/adapters/cli/components/Toast
 */
import type { IToast, IToastConfig, ToastType } from '../../../core/interfaces';
/**
 * 终端提示组件
 * 将提示消息输出到标准输出
 */
export class TerminalToast implements IToast {
  private typeColors: Record<ToastType, string> = {
    success: '\x1b[32m',
    error: '\x1b[31m',
    info: '\x1b[36m',
    warning: '\x1b[33m',
  };
  show(message: string, config?: IToastConfig): void {
    const type = config?.type ?? 'info';
    this.display(message, type);
  }
  success(message: string, _duration?: number): void {
    this.display(message, 'success');
  }
  error(message: string, _duration?: number): void {
    this.display(message, 'error');
  }
  warning(message: string, _duration?: number): void {
    this.display(message, 'warning');
  }
  info(message: string, _duration?: number): void {
    this.display(message, 'info');
  }
  closeAll(): void {
    // terminal toast doesn't persist
  }
  setConfig(_config: IToastConfig): void {
    // unused in terminal
  }
  render(): void {
    // terminal toast renders immediately
  }
  destroy(): void {
    // no cleanup needed
  }
  private display(message: string, type: ToastType): void {
    const color = this.typeColors[type];
    const prefix = this.getPrefix(type);
    console.log(`${color}${prefix} ${message}\x1b[0m`);
  }
  private getPrefix(type: ToastType): string {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      case 'warning':
        return '⚠';
      case 'info':
        return 'ℹ';
    }
  }
}
