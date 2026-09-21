/**
 * 主窗口单例登记处。
 *
 * 通知点击等功能需要聚焦"真正的单例主窗口"，而不是通过
 * BrowserWindow.getAllWindows() 去猜第一个窗口——那样会误选到隐藏的
 * 后台 worker 窗口或 sniffer 离屏窗口，造成"点击通知打开了一个新窗口"的假象。
 *
 * 这里用独立模块保存主窗口引用，避免 index.ts 与 task-manager.ts 形成循环依赖。
 */

import { BrowserWindow } from 'electron';

let mainWindowRef: BrowserWindow | null = null;

/** 主进程在创建/销毁主窗口时调用，登记或清空单例引用。 */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

/** 获取单例主窗口；不存在或已销毁返回 null。 */
export function getMainWindow(): BrowserWindow | null {
  if (mainWindowRef && mainWindowRef.isDestroyed()) {
    mainWindowRef = null;
  }
  return mainWindowRef;
}
