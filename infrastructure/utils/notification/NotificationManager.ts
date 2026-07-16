import type { INotificationProvider, Notification, NotifyOptions, NotificationType } from './types';
import {
  BrowserNotifier,
  ElectronNotifier,
  MobileNotifier,
  MiniProgramNotifier,
  TerminalNotifier,
} from './adapters';

/**
 * 通知管理器
 * 自动检测运行环境并使用合适的适配器
 */
export class NotificationManager {
  private provider: INotificationProvider;

  constructor(provider?: INotificationProvider) {
    this.provider = provider ?? this.detectProvider();
  }

  /** 自动检测运行环境 */
  private detectProvider(): INotificationProvider {
    try { // Electron
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      if (require('electron')) return new ElectronNotifier();
    } catch { /* not in electron */ }

    if (typeof window !== 'undefined' && 'Notification' in window) return new BrowserNotifier();
    // @ts-ignore - wx 是微信小程序的全局对象
    if (typeof wx !== 'undefined') return new MiniProgramNotifier();
    return new TerminalNotifier();
  }

  getPlatform(): string { return this.provider.platform; }
  async isAvailable(): Promise<boolean> { return this.provider.isAvailable(); }
  async hasPermission(): Promise<boolean> { return this.provider.hasPermission(); }
  async requestPermission(): Promise<boolean> { return this.provider.requestPermission(); }

  /** 发送通知 */
  async notify(notification: Notification): Promise<void> {
    if (!await this.provider.hasPermission()) {
      const granted = await this.provider.requestPermission();
      if (!granted) throw new Error('Notification permission denied');
    }
    return this.provider.notify(notification);
  }

  /** 快捷方法 */
  private async quickNotify(type: NotificationType, title: string, body: string, options?: NotifyOptions): Promise<void> {
    return this.notify({ id: `${type}-${Date.now()}`, title, body, type, ...options });
  }

  async info(title: string, body: string, options?: NotifyOptions): Promise<void> {
    return this.quickNotify('info', title, body, options);
  }

  async success(title: string, body: string, options?: NotifyOptions): Promise<void> {
    return this.quickNotify('success', title, body, options);
  }

  async warning(title: string, body: string, options?: NotifyOptions): Promise<void> {
    return this.quickNotify('warning', title, body, options);
  }

  async error(title: string, body: string, options?: NotifyOptions): Promise<void> {
    return this.quickNotify('error', title, body, options);
  }

  async progress(id: string, progress: number, message: string): Promise<void> {
    return this.notify({
      id, title: '进度更新', body: message, type: 'progress',
      progress: Math.min(100, Math.max(0, progress)),
    });
  }
}
