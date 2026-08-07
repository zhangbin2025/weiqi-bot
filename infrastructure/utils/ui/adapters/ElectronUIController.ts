/**
 * Electron 平台 UI 控制器
 */
import type { IUIController, PageRoute, UIState } from '../types';

export class ElectronUIController implements IUIController {
  readonly platform = 'electron' as const;
  private windowManager: any;

  async isAvailable(): Promise<boolean> {
    try {
      // 检测 Electron 环境
      return typeof process !== 'undefined' &&
             process.versions != null &&
             process.versions['electron'] != null;
    } catch {
      return false;
    }
  }

  setWindowManager(manager: any): void {
    this.windowManager = manager;
  }

  async openPage(page: PageRoute, params?: Record<string, any>): Promise<void> {
    if (!this.windowManager) {
      throw new Error('Window manager not configured');
    }

    const url = this.buildUrl(page, params);
    await this.windowManager.createWindow(url);
  }

  async closePage(): Promise<void> {
    if (this.windowManager) {
      await this.windowManager.closeCurrentWindow();
    }
  }

  async updateState(state: UIState): Promise<void> {
    if (this.windowManager && state.message) {
      await this.windowManager.sendToRenderer('update-state', state);
    }
  }

  async showProgress(_taskId: string, progress: number, message: string): Promise<void> {
    if (this.windowManager) {
      await this.windowManager.sendToRenderer('progress', { progress, message });
    }
  }

  async focusWindow(windowId: string): Promise<void> {
    if (this.windowManager) {
      await this.windowManager.focusWindow(windowId);
    }
  }

  private buildUrl(page: PageRoute, params?: Record<string, any>): string {
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
