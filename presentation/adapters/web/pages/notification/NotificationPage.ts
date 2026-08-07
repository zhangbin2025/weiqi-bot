/**
 * 通知中心页面控制器
 * @module presentation/pages/notification/NotificationPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, INotification, INotificationItem, PageParams } from '../../../../core/interfaces';
/**
 * 通知中心页面配置
 */
export interface NotificationPageConfig {
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
/**
 * 通知中心页面
 * 显示和管理所有通知
 */
export class NotificationPage implements IPage {
  readonly title = '通知中心';
  private notification: INotification;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private initialized = false;
  constructor(config: NotificationPageConfig = {}) {
    this.onNavigate = config.onNavigate;
    this.notification = AdapterFactory.createNotification();
  }
  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    // 设置点击回调
    this.notification.onClick((id: string) => {
      this.handleNotificationClick(id);
    });
    this.initialized = true;
  }
  /**
   * 处理通知点击
   */
  private handleNotificationClick(id: string): void {
    // 标记已读
    this.notification.markAsRead(id);
    // 获取通知详情
    const items = this.notification.getAll();
    const item = items.find((i) => i.id === id);
    if (item?.data) {
      const data = item.data as { page?: string; params?: Record<string, string> };
      if (data.page && this.onNavigate) {
        this.onNavigate(data.page, data.params);
      }
    }
  }
  /**
   * 获取所有通知
   */
  getAllNotifications(): INotificationItem[] {
    return this.notification.getAll();
  }
  /**
   * 获取未读数量
   */
  getUnreadCount(): number {
    return this.notification.getUnreadCount();
  }
  /**
   * 标记全部已读
   */
  markAllAsRead(): void {
    this.notification.markAllAsRead();
  }
  /**
   * 删除通知
   */
  removeNotification(id: string): void {
    this.notification.remove(id);
  }
  /**
   * 清空所有通知
   */
  clearAllNotifications(): void {
    this.notification.clearAll();
  }
  /**
   * 处理参数
   */
  handleParams(params: PageParams): void {
    // 处理筛选参数
    if (params['filter'] === 'unread') {
      // 只显示未读
    }
    // 处理排序参数
    if (params['sort'] === 'priority') {
      // 按优先级排序
    }
  }
  /**
   * 渲染
   */
  render(): void {
    this.notification.render();
  }
  /**
   * 销毁
   */
  destroy(): void {
    this.notification.destroy();
    this.initialized = false;
  }
}
