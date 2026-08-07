/**
 * 小程序 UI 控制器
 * 使用微信小程序 API
 */
import type { IUIController, PageRoute, UIState } from '../types';

declare const wx: {
  navigateTo(options: { url: string; success?: () => void; fail?: (err: any) => void }): void;
  redirectTo(options: { url: string; success?: () => void; fail?: (err: any) => void }): void;
  navigateBack(options?: { delta?: number }): void;
  showToast(options: { title: string; icon?: string }): void;
};

export class MiniProgramUIController implements IUIController {
  readonly platform = 'miniprogram' as const;

  async isAvailable(): Promise<boolean> {
    return typeof wx !== 'undefined';
  }

  async openPage(page: PageRoute, params?: Record<string, any>): Promise<void> {
    if (!await this.isAvailable()) {
      throw new Error('WeChat MiniProgram environment not available');
    }

    const url = this.buildMiniProgramUrl(page, params);

    return new Promise((resolve, reject) => {
      wx.navigateTo({
        url,
        success: () => resolve(),
        fail: (err) => reject(new Error(`Failed to navigate: ${err.errMsg}`))
      });
    });
  }

  async redirectTo(page: PageRoute, params?: Record<string, any>): Promise<void> {
    if (!await this.isAvailable()) {
      throw new Error('WeChat MiniProgram environment not available');
    }

    const url = this.buildMiniProgramUrl(page, params);

    return new Promise((resolve, reject) => {
      wx.redirectTo({
        url,
        success: () => resolve(),
        fail: (err) => reject(new Error(`Failed to redirect: ${err.errMsg}`))
      });
    });
  }

  async closePage(): Promise<void> {
    if (!await this.isAvailable()) {
      throw new Error('WeChat MiniProgram environment not available');
    }

    wx.navigateBack({ delta: 1 });
  }

  async showProgress(_taskId: string, _progress: number, message: string): Promise<void> {
    if (!await this.isAvailable()) {
      return;
    }

    wx.showToast({
      title: message,
      icon: 'loading'
    });
  }

  private buildMiniProgramUrl(page: PageRoute, params?: Record<string, any>): string {
    let url = page;

    if (params) {
      const query = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (query) {
        url += `?${query}`;
      }
    }

    return url;
  }
}
