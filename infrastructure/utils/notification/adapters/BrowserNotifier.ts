import type { INotificationProvider, Notification } from '../types';

/**
 * 浏览器通知适配器
 * 
 * 使用浏览器原生 Notification API
 * 
 * @ai-example
 * ```typescript
 * const notifier = new BrowserNotifier();
 * 
 * if (await notifier.isAvailable()) {
 *   await notifier.notify({
 *     id: '1',
 *     title: '通知标题',
 *     body: '通知内容',
 *     type: 'info'
 *   });
 * }
 * ```
 */
export class BrowserNotifier implements INotificationProvider {
  readonly platform = 'browser' as const;

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  async hasPermission(): Promise<boolean> {
    if (!await this.isAvailable()) return false;
    return window.Notification.permission === 'granted';
  }

  async requestPermission(): Promise<boolean> {
    if (!await this.isAvailable()) return false;
    
    const permission = await window.Notification.requestPermission();
    return permission === 'granted';
  }

  async notify(notification: Notification): Promise<void> {
    if (!await this.hasPermission()) {
      throw new Error('Notification permission not granted');
    }

    const browserNotif = new window.Notification(notification.title, {
      body: notification.body,
      silent: notification.silent as boolean | undefined,
      data: notification.data as Record<string, unknown> | undefined,
    } as NotificationOptions);

    // 处理点击事件
    browserNotif.onclick = () => {
      browserNotif.close();
      // 可以通过自定义事件触发动作
      window.dispatchEvent(new CustomEvent('notification-click', {
        detail: notification,
      }));
    };

    // 自动关闭（非进度通知）
    if (notification.type !== 'progress') {
      setTimeout(() => browserNotif.close(), 5000);
    }
  }
}
