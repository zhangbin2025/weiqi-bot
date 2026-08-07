/**
 * 通知中心接口
 * @module presentation/core/interfaces/INotification
 */
/**
 * 通知类型
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'progress';
/**
 * 通知优先级
 */
export type NotificationPriority = 'low' | 'normal' | 'high';
/**
 * 通知动作
 */
export interface NotificationAction {
  label: string;
  action: string;
}
/**
 * 通知项
 */
export interface INotificationItem {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  priority?: NotificationPriority;
  progress?: number;
  timestamp: number;
  read: boolean;
  data?: unknown;
  actions?: NotificationAction[];
}
/**
 * 通知中心接口
 * 定义持久化通知管理的抽象接口
 */
export interface INotification {
  /** 添加通知 */
  add(item: Omit<INotificationItem, 'id' | 'timestamp' | 'read'>): string;
  /** 更新通知 */
  update(id: string, updates: Partial<INotificationItem>): void;
  /** 更新进度 */
  updateProgress(id: string, progress: number, message?: string): void;
  /** 标记已读 */
  markAsRead(id: string): void;
  /** 标记全部已读 */
  markAllAsRead(): void;
  /** 删除通知 */
  remove(id: string): void;
  /** 清空所有 */
  clearAll(): void;
  /** 获取所有通知 */
  getAll(): INotificationItem[];
  /** 获取未读数量 */
  getUnreadCount(): number;
  /** 设置点击回调 */
  onClick(callback: (id: string) => void): void;
  /** 渲染 */
  render(): void;
  /** 销毁 */
  destroy(): void;
}
