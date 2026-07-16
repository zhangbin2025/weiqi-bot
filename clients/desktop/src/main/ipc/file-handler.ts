/**
 * 文件桥接处理器
 * 
 * 对等 Android FileBridgeHandler
 * 处理 file:* 前缀的桥接消息
 * 
 * 重要：所有 handle 调用必须同步返回，因为 sendSync 不支持异步
 * 使用 dialog.showSaveDialogSync 替代异步版本
 */

import { BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';

export class FileHandler {
  readonly prefix = 'file:';

  constructor(private window: BrowserWindow) {}

  handle(message: string): string {
    // 解析消息：file:action:json（保留 JSON 中的冒号）
    // 注意：JS 的 split(str, limit) 会丢弃剩余部分，必须手动拼接
    const parts = message.split(':');
    if (parts.length < 3) {
      return JSON.stringify({ error: 'Invalid format' });
    }

    const action = parts[1];
    const jsonStr = parts.slice(2).join(':');

    switch (action) {
      case 'save':
        return this.handleSave(jsonStr);
      default:
        return JSON.stringify({ error: `Unknown action: ${action}` });
    }
  }

  private handleSave(jsonStr: string): string {
    try {
      const json = JSON.parse(jsonStr);
      const filename = json.filename;
      const content = json.content; // Base64
      const mimeType = json.mimeType || 'application/octet-stream';

      // 显示保存对话框（同步版本，避免异步问题）
      const filePath = dialog.showSaveDialogSync(this.window, {
        title: '保存文件',
        defaultPath: filename,
        filters: [
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (!filePath) {
        return JSON.stringify({ success: false, error: 'User cancelled' });
      }

      // 解码 Base64 并写入文件
      const buffer = Buffer.from(content, 'base64');
      fs.writeFileSync(filePath, buffer);

      return JSON.stringify({ success: true, path: filePath });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }
}
