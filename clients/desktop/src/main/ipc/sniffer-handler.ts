/**
 * 抓包桥接处理器
 * 
 * 对等 Android SnifferBridgeHandler
 * 处理 sniffer:// 前缀的桥接消息
 */

import { BrowserWindow } from 'electron';
import { SnifferManager } from '../sniffer/sniffer-manager';

export class SnifferHandler {
  readonly prefix = 'sniffer://';
  private snifferManager: SnifferManager;

  constructor(window: BrowserWindow) {
    this.snifferManager = new SnifferManager(window);
  }

  handle(message: string): string {
    const handled = this.snifferManager.handleSnifferUri(message);
    return handled ? 'ok' : JSON.stringify({ error: 'Unknown sniffer command' });
  }
}
