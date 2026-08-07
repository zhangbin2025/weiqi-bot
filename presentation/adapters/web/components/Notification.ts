/**
 * Web Notification 组件
 */
import type { INotification, INotificationItem } from '../../../core/interfaces';
export class WebNotification implements INotification {
  private element: HTMLElement;
  private items: Map<string, INotificationItem> = new Map();
  private clickCallback?: (id: string) => void;
  private idCounter = 0;
  constructor(container?: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'web-notification';
    this.element.style.cssText = `
      position: fixed; top: 20px; right: 20px;
      width: 320px; z-index: 1500;
    `;
    if (container) container.appendChild(this.element);
  }
  add(item: Omit<INotificationItem, 'id'>): string {
    const id = `notification-${++this.idCounter}`;
    const notification: INotificationItem = {
      ...item,
      id,
      read: false,
      timestamp: Date.now()
    };
    this.items.set(id, notification);
    this.renderItem(notification);
    return id;
  }
  update(id: string, updates: Partial<INotificationItem>): void {
    const item = this.items.get(id);
    if (item) {
      Object.assign(item, updates);
      this.updateItemElement(item);
    }
  }
  updateProgress(id: string, progress: number): void {
    this.update(id, { progress });
  }
  markAsRead(id: string): void {
    this.update(id, { read: true });
  }
  clearAll(): void {
    this.items.clear();
    this.element.innerHTML = '';
  }
  getAll(): INotificationItem[] {
    return Array.from(this.items.values());
  }
  getUnreadCount(): number {
    return Array.from(this.items.values()).filter(item => !item.read).length;
  }
  onClick(callback: (id: string) => void): void {
    this.clickCallback = callback;
  }
  private renderItem(item: INotificationItem): void {
    const el = document.createElement('div');
    el.id = `notification-item-${item.id}`;
    el.className = `web-notification__item web-notification__item--${item.type || 'info'}`;
    el.style.cssText = `
      background: white; border-left: 4px solid #1890ff;
      padding: 12px; margin-bottom: 8px; border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: pointer;
    `;
    el.innerHTML = `
      <div class="web-notification__title" style="font-weight: 500;">${item.title}</div>
      ${item.body ? `<div class="web-notification__content" style="font-size: 12px; color: #666;">${item.body}</div>` : ''}
      ${item.progress !== undefined ? this.renderProgressBar(item.progress) : ''}
    `;
    el.addEventListener('click', () => this.clickCallback?.(item.id));
    this.element.appendChild(el);
  }
  private renderProgressBar(progress: number): string {
    return `
      <div style="height: 4px; background: #f0f0f0; margin-top: 8px; border-radius: 2px;">
        <div style="width: ${progress}%; height: 100%; background: #1890ff; border-radius: 2px; transition: width 0.3s;"></div>
      </div>
    `;
  }
  private updateItemElement(item: INotificationItem): void {
    const el = document.getElementById(`notification-item-${item.id}`);
    if (!el) return;
    const contentEl = el.querySelector('.web-notification__content');
    if (contentEl && item.body) contentEl.textContent = item.body;
    if (item.progress !== undefined) {
      const progressBar = el.querySelector('[style*="width:"]') as HTMLElement;
      if (progressBar) progressBar.style.width = `${item.progress}%`;
    }
  }
  render(): void {
    this.element.innerHTML = '';
    this.items.forEach(item => this.renderItem(item));
  }
  remove(id: string): void {
    this.items.delete(id);
    this.render();
  }
  destroy(): void {
    this.element.remove();
  }
  markAllAsRead(): void { /* TODO */ }
}
