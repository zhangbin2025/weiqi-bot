/**
 * 控制台日志桥接处理器
 * 
 * 对等 Android ConsoleBridgeHandler
 * 处理 console: 前缀的桥接消息
 */

import { LogManager } from '../utils/log-manager';

export class ConsoleHandler {
  readonly prefix = 'console:';

  handle(message: string): string {
    const json = message.substring(this.prefix.length);
    
    try {
      const log = JSON.parse(json);
      const level = log.level || 'LOG';
      const msg = log.msg || '';
      const caller = log.caller || '';

      // 格式化消息（对齐 Android ConsoleHook）
      const formatted = caller ? `[JS] ${caller} - ${msg}` : `[JS] ${msg}`;

      // 存储到 LogManager
      LogManager.getInstance().log(level, 'Console', formatted);
    } catch (error) {
      console.log('[Renderer]', json);
    }

    return 'ok';
  }
}
