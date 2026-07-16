/**
 * Web Toast 组件
 */
import type { IToast, IToastConfig, ToastType } from '../../../core/interfaces';

export class WebToast implements IToast {
  private container: HTMLElement;
  private currentToast: HTMLElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessage: string = '';
  private lastMessageTime: number = 0;
  private static styleInjected = false;

  constructor() {
    // 注入动画样式（只注入一次）
    if (!WebToast.styleInjected) {
      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes slideDown {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
      WebToast.styleInjected = true;
    }

    this.container = document.createElement('div');
    this.container.className = 'web-toast-container';
    this.container.style.cssText = `
      position: fixed; bottom: 24px; left: 50%;
      transform: translateX(-50%); z-index: 2000;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
  }

  show(message: string, config?: IToastConfig): void {
    const type: ToastType = (config?.type as ToastType) || 'info';
    
    // 防抖：如果 500ms 内显示相同消息，忽略
    const now = Date.now();
    if (message === this.lastMessage && now - this.lastMessageTime < 500) {
      return;
    }
    this.lastMessage = message;
    this.lastMessageTime = now;
    
    // 立即清除旧的 toast（不等待动画）
    this.hideImmediate();
    
    this.currentToast = document.createElement('div');
    this.currentToast.className = `web-toast web-toast--${type}`;
    const icons: Record<ToastType, string> = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    this.currentToast.style.cssText = `
      background: rgba(0, 0, 0, 0.8); color: white;
      padding: 12px 24px; border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.3s ease;
      pointer-events: auto;
      display: flex; align-items: center; gap: 8px;
      font-size: 14px;
    `;

    // 图标
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icons[type];
    iconSpan.style.cssText = 'font-size: 16px; font-weight: bold;';

    // 文字
    const textSpan = document.createElement('span');
    textSpan.textContent = message;

    this.currentToast.appendChild(iconSpan);
    this.currentToast.appendChild(textSpan);
    this.container.appendChild(this.currentToast);

    this.hideTimer = setTimeout(() => this.hide(), 3000);
  }

  success(message: string, duration?: number): void {
    this.showWithDuration(message, 'success', duration);
  }

  error(message: string, duration?: number): void {
    this.showWithDuration(message, 'error', duration);
  }

  warning(message: string, duration?: number): void {
    this.showWithDuration(message, 'warning', duration);
  }

  info(message: string, duration?: number): void {
    this.showWithDuration(message, 'info', duration);
  }

  private showWithDuration(message: string, type: ToastType, duration?: number): void {
    // 防抖：如果 500ms 内显示相同消息，忽略
    const now = Date.now();
    if (message === this.lastMessage && now - this.lastMessageTime < 500) {
      return;
    }
    this.lastMessage = message;
    this.lastMessageTime = now;
    
    // 立即清除旧的 toast（不等待动画）
    this.hideImmediate();
    
    this.currentToast = document.createElement('div');
    this.currentToast.className = `web-toast web-toast--${type}`;
    const icons: Record<ToastType, string> = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    this.currentToast.style.cssText = `
      background: rgba(0, 0, 0, 0.8); color: white;
      padding: 12px 24px; border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.3s ease;
      pointer-events: auto;
      display: flex; align-items: center; gap: 8px;
      font-size: 14px;
    `;

    // 图标
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icons[type];
    iconSpan.style.cssText = 'font-size: 16px; font-weight: bold;';

    // 文字
    const textSpan = document.createElement('span');
    textSpan.textContent = message;

    this.currentToast.appendChild(iconSpan);
    this.currentToast.appendChild(textSpan);
    this.container.appendChild(this.currentToast);

    this.hideTimer = setTimeout(() => this.hide(), duration ?? 3000);
  }

  hide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.currentToast) {
      this.currentToast.style.animation = 'slideDown 0.3s ease';
      setTimeout(() => {
        this.currentToast?.remove();
        this.currentToast = null;
      }, 300);
    }
  }

  /**
   * 立即隐藏（不等待动画）
   */
  private hideImmediate(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.currentToast) {
      this.currentToast.remove();
      this.currentToast = null;
    }
  }

  closeAll(): void {
    this.hideImmediate();
    this.container.innerHTML = '';
  }

  destroy(): void {
    this.hideImmediate();
    this.container.remove();
  }
}
