import type { INotificationProvider, Notification } from '../types';

/**
 * 小程序订阅消息适配器
 * 使用小程序订阅消息 API，需要用户预先授权
 */

/** 小程序 API 接口 */
interface MiniProgramAPI {
  requestSubscribeMessage(options: {
    tmplIds: string[];
    success?: (res: { [key: string]: string }) => void;
    fail?: (err: Error) => void;
  }): void;
  showModal(options: { title: string; content: string; showCancel?: boolean }): void;
}

declare const wx: MiniProgramAPI | undefined;

export class MiniProgramNotifier implements INotificationProvider {
  readonly platform = 'miniprogram' as const;

  async isAvailable(): Promise<boolean> {
    return typeof wx !== 'undefined' && typeof wx.requestSubscribeMessage === 'function';
  }

  async hasPermission(): Promise<boolean> {
    return this.isAvailable(); // 小程序需要用户每次授权
  }

  async requestPermission(): Promise<boolean> {
    return this.isAvailable(); // 实际授权在 notify 时进行
  }

  async notify(notification: Notification): Promise<void> {
    if (!await this.isAvailable()) throw new Error('MiniProgram API not available');

    const templateId = notification.data?.['templateId'] as string;
    if (!templateId) {
      wx!.showModal({ title: notification.title, content: notification.body, showCancel: false });
      return;
    }

    return new Promise((resolve, reject) => {
      wx!.requestSubscribeMessage({
        tmplIds: [templateId],
        success: (res) => {
          if (res[templateId] === 'accept') resolve();
          else reject(new Error('User rejected subscription'));
        },
        fail: reject,
      });
    });
  }
}
