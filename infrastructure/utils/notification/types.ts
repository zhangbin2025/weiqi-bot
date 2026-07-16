/**
 * 通知系统类型定义
 */

/** 通知类型 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'progress';

/** 通知动作 */
export interface NotificationAction {
  label: string;
  action: string;  // 'open' | 'dismiss' | 'view' | 'cancel'
  data?: unknown;
}

/** 通知内容 */
export interface Notification {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
  progress?: number;  // 0-100，用于进度通知
  silent?: boolean;    // 是否静默
}

/** 通知提供者接口 */
export interface INotificationProvider {
  /** 发送通知 */
  notify(notification: Notification): Promise<void>;
  
  /** 检查权限 */
  hasPermission(): Promise<boolean>;
  
  /** 请求权限 */
  requestPermission(): Promise<boolean>;
  
  /** 平台标识 */
  readonly platform: 'browser' | 'electron' | 'mobile' | 'miniprogram' | 'terminal';
  
  /** 是否可用 */
  isAvailable(): Promise<boolean>;
}

/** 通知选项（用于快捷方法） */
export interface NotifyOptions {
  silent?: boolean;
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
}
