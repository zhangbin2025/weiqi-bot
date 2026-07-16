/**
 * 剪贴板桥接处理器
 * 
 * 对等 Android ClipboardBridgeHandler
 * 处理 clipboard: 前缀的桥接消息
 */

import { clipboard } from 'electron';

export class ClipboardHandler {
  readonly prefix = 'clipboard:';

  handle(message: string): string {
    const action = message.substring(this.prefix.length);

    switch (action) {
      case 'read':
        return clipboard.readText() || '';
      default:
        return JSON.stringify({ error: `Unknown clipboard action: ${action}` });
    }
  }
}
