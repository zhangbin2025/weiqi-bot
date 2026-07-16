/**
 * Web 平台 UI 控制器
 */
import type { IUIController, PageRoute, UIState } from '../types';

export class WebUIController implements IUIController {
  readonly platform = 'web' as const;

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }

  async openPage(page: PageRoute, params?: Record<string, any>): Promise<void> {
    if (!await this.isAvailable()) {
      throw new Error('Web environment not available');
    }

    const url = this.buildUrl(page, params);

    // 默认在当前窗口打开
    window.location.href = url;
  }

  openInNewWindow(page: PageRoute, params?: Record<string, any>): void {
    const url = this.buildUrl(page, params);
    window.open(url, '_blank');
  }

  async closePage(): Promise<void> {
    // Web 环境通常不关闭页面，但可以返回上一页
    if (window.history.length > 1) {
      window.history.back();
    }
  }

  async updateState(state: UIState): Promise<void> {
    // 可以通过 URL 参数或全局状态管理
    if (state.message) {
      document.title = state.message;
    }
  }

  async showProgress(_taskId: string, progress: number, message: string): Promise<void> {
    console.log(`[Progress] ${progress}% - ${message}`);
  }

  private buildUrl(page: PageRoute, params?: Record<string, any>): string {
    const url = new URL(page, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    return url.toString();
  }
}
