import type { INotificationProvider, Notification } from '../types';

/**
 * Electron 通知适配器
 * 
 * 使用 Electron Notification 模块
 * 需要在主进程或渲染进程中使用
 * 
 * @ai-example
 * ```typescript
 * // 在 Electron 主进程
 * import { Notification } from 'electron';
 * 
 * const notifier = new ElectronNotifier();
 * await notifier.notify({
 *   id: '1',
 *   title: '下载完成',
 *   body: '文件已保存',
 *   type: 'success'
 * });
 * ```
 */
export class ElectronNotifier implements INotificationProvider {
  readonly platform = 'electron' as const;
  private electronNotification?: typeof import('electron').Notification;

  constructor() {
    // 动态加载 electron 模块
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.electronNotification = require('electron').Notification;
    } catch {
      // Electron 未安装或不在 Electron 环境中
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.electronNotification !== undefined;
  }

  async hasPermission(): Promise<boolean> {
    // Electron 默认有权限
    return this.electronNotification !== undefined;
  }

  async requestPermission(): Promise<boolean> {
    // Electron 不需要请求权限
    return this.electronNotification !== undefined;
  }

  async notify(notification: Notification): Promise<void> {
    if (!this.electronNotification) {
      throw new Error('Electron Notification not available');
    }

    const notifOptions: { title: string; body?: string; actions?: unknown[] } = {
      title: notification.title,
      body: notification.body,
    };
    if (notification.actions) {
      notifOptions.actions = (notification.actions as unknown as Array<{ type: string; text: string }>).map(a => ({ type: 'button' as const, text: a.text }));
    }
    const electronNotif = new this.electronNotification(notifOptions);

    // 显示通知
    electronNotif.show();

    // 处理点击事件
    electronNotif.on('click', () => {
      electronNotif.close();
      // 触发点击动作
      const firstAction = notification.actions?.[0];
      if (firstAction) {
        // 可以通过事件总线或回调触发动作
        process.emit('notification-action' as any, firstAction as any);
      }
    });

    // 处理按钮点击
    electronNotif.on('action', (...args: unknown[]) => {
      const index = args[1] as number; const action = notification.actions?.[index];
      if (action) {
        process.emit('notification-action' as any, action as any);
      }
    });
  }
}
