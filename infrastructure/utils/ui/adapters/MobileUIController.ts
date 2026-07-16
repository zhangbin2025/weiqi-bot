/**
 * 移动 App UI 控制器
 * 抽象实现，具体路由由移动端桥接
 */
import type { IUIController, PageRoute, UIState } from '../types';

export interface MobileBridge {
  navigate(page: string, params?: Record<string, any>): Promise<void>;
  goBack(): Promise<void>;
  updateUI(state: UIState): Promise<void>;
}

export class MobileUIController implements IUIController {
  readonly platform = 'mobile' as const;
  private bridge: MobileBridge | null = null;

  async isAvailable(): Promise<boolean> {
    // 检测移动端环境标志
    return typeof window !== 'undefined' &&
           (window as any).__MOBILE_BRIDGE__ !== undefined;
  }

  setBridge(bridge: MobileBridge): void {
    this.bridge = bridge;
  }

  async openPage(page: PageRoute, params?: Record<string, any>): Promise<void> {
    const bridge = this.getBridge();
    await bridge.navigate(page, params);
  }

  async closePage(): Promise<void> {
    const bridge = this.getBridge();
    await bridge.goBack();
  }

  async updateState(state: UIState): Promise<void> {
    const bridge = this.getBridge();
    await bridge.updateUI(state);
  }

  async showProgress(_taskId: string, progress: number, message: string): Promise<void> {
    const bridge = this.getBridge();
    await bridge.updateUI({ loading: true, progress, message });
  }

  private getBridge(): MobileBridge {
    if (!this.bridge) {
      // 尝试从全局获取桥接对象
      const globalBridge = (window as any).__MOBILE_BRIDGE__;
      if (globalBridge) {
        this.bridge = globalBridge;
      }
    }
    if (!this.bridge) {
      throw new Error('Mobile bridge not configured');
    }
    return this.bridge;
  }
}
