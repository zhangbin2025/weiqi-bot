/**
 * 浏览器代理提供者工具函数
 */

import type { IWebSocket } from '../../interfaces';

/**
 * 创建 WebSocket 包装器
 */
export function createWebSocketWrapper(ws: WebSocket): IWebSocket {
  return {
    get readyState() {
      return ws.readyState;
    },
    get url() {
      return ws.url;
    },
    send: (data: string | ArrayBuffer) => ws.send(data),
    close: () => ws.close(),
    onMessage: (callback) => {
      ws.onmessage = (event) => {
        callback({
          data: event.data,
          type: 'message',
          timestamp: Date.now()
        });
      };
    },
    onError: (callback) => {
      ws.onerror = () => callback(new Error('WebSocket error'));
    },
    onClose: (callback) => {
      ws.onclose = () => callback();
    },
    onOpen: (callback) => {
      ws.onopen = () => callback();
    }
  };
}

/**
 * 提取响应头
 * @param headers 响应头对象
 * @param useAssetServer 是否使用 AssetServer（App 环境）
 */
export function extractHeaders(
  headers: Headers,
  useAssetServer: boolean = false
): Record<string, string> {
  const result: Record<string, string> = {};
  
  if (useAssetServer) {
    // App 环境（AssetServer）：处理 X-Set-Cookie
    const xSetCookies: string[] = [];
    headers.forEach((value, key) => {
      if (key.toLowerCase() === 'x-set-cookie') {
        xSetCookies.push(value);
      }
    });
    if (xSetCookies.length > 0) {
      result['set-cookie'] = JSON.stringify(xSetCookies);
    }
  }
  
  // 处理其他响应头
  headers.forEach((value, key) => {
    if (!useAssetServer || key.toLowerCase() !== 'x-set-cookie') {
      result[key] = value;
    }
  });
  
  return result;
}
