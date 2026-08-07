// infrastructure/config/schemas/NotificationConfigSchema.ts

/**
 * 通知提供者类型
 */
export type NotificationProvider = 'browser' | 'electron' | 'mobile' | 'miniprogram' | 'terminal';

/**
 * 静默时段配置
 */
export interface IQuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

/**
 * 通知配置
 */
export interface INotificationConfig {
  /** 默认通知提供者 */
  defaultProvider: NotificationProvider;

  /** 是否启用通知 */
  enabled: boolean;

  /** 任务完成通知 */
  notifyOnTaskComplete: boolean;

  /** 任务失败通知 */
  notifyOnTaskFailed: boolean;

  /** 进度更新间隔（毫秒） */
  progressUpdateInterval: number;

  /** 静默时段（不发送通知） */
  quietHours?: IQuietHours;
}

/**
 * 通知配置 Schema（纯类型定义，兼容 zod 接口）
 */
export const NotificationConfigSchema = {
  defaultValues: {
    defaultProvider: 'browser' as const,
    enabled: true,
    notifyOnTaskComplete: true,
    notifyOnTaskFailed: true,
    progressUpdateInterval: 1000,
  },
} as const;

export type NotificationConfig = INotificationConfig;
