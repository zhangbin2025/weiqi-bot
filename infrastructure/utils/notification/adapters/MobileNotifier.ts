import type { INotificationProvider, Notification } from '../types';

/**
 * 移动应用通知适配器
 * 
 * 抽象接口，具体实现由移动端桥接提供
 * 支持 React Native、Flutter、Capacitor 等
 * 
 * @ai-example
 * ```typescript
 * // 设置桥接实现
 * MobileNotifier.setBridge({
 *   showNotification: async (notif) => {
 *     await ReactNativePushNotification.localNotification(notif);
 *   }
 * });
 * 
 * const notifier = new MobileNotifier();
 * await notifier.notify({
 *   id: '1',
 *   title: '消息提醒',
 *   body: '您有新消息',
 *   type: 'info'
 * });
 * ```
 */

/** 移动端通知桥接接口 */
export interface IMobileBridge {
  showNotification(notification: Notification): Promise<void>;
  checkPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
}

/** 桥接实例存储 */
let mobileBridge: IMobileBridge | null = null;

export class MobileNotifier implements INotificationProvider {
  readonly platform = 'mobile' as const;

  /**
   * 设置移动端桥接实现
   */
  static setBridge(bridge: IMobileBridge): void {
    mobileBridge = bridge;
  }

  async isAvailable(): Promise<boolean> {
    return mobileBridge !== null;
  }

  async hasPermission(): Promise<boolean> {
    if (!mobileBridge) return false;
    return mobileBridge.checkPermission();
  }

  async requestPermission(): Promise<boolean> {
    if (!mobileBridge) return false;
    return mobileBridge.requestPermission();
  }

  async notify(notification: Notification): Promise<void> {
    if (!mobileBridge) {
      throw new Error('Mobile bridge not configured. Call MobileNotifier.setBridge() first.');
    }

    return mobileBridge.showNotification(notification);
  }
}
