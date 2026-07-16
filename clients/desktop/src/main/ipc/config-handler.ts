/**
 * 配置桥接处理器
 * 
 * 对等 Android ConfigBridgeHandler
 * 处理 config:* 前缀的桥接消息
 */

import { AppConfig } from '../config';

export class ConfigHandler {
  readonly prefix = 'config:';

  handle(message: string): string {
    const parts = message.split(':');
    if (parts.length < 2) {
      return JSON.stringify({ error: 'Invalid format' });
    }

    const action = parts[1];

    switch (action) {
      case 'get':
        return JSON.stringify({
          localHost: AppConfig.localHost,
          localPort: AppConfig.localPort,
          localServerUrl: AppConfig.localServerUrl,
          homeUrl: AppConfig.homeUrl,
          remoteBase: AppConfig.remoteBase,
          versionUrl: AppConfig.versionUrl,
        });

      default:
        return JSON.stringify({ error: `Unknown action: ${action}` });
    }
  }
}
