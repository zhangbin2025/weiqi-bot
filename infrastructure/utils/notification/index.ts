/**
 * 通知系统模块
 * 
 * 提供跨平台的通知能力，支持浏览器、Electron、移动端、小程序和终端
 * 
 * @example
 * ```typescript
 * import { NotificationManager } from '@/infrastructure/utils/notification';
 * 
 * const manager = new NotificationManager();
 * await manager.success('成功', '操作已完成');
 * ```
 */

// 类型导出
export type {
  NotificationType,
  NotificationAction,
  Notification,
  INotificationProvider,
  NotifyOptions,
} from './types';

// 适配器导出
export {
  BrowserNotifier,
  ElectronNotifier,
  MobileNotifier,
  MiniProgramNotifier,
  TerminalNotifier,
} from './adapters';

export type { IMobileBridge } from './adapters';

// 核心类导出
export { NotificationManager } from './NotificationManager';
