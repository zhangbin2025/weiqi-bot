/**
 * @fileoverview 101围棋网 WebSocket 辅助类
 */

import type { IWebSocket } from '../../../../infrastructure/network/interfaces/IWebSocket';
import type {
  Weiqi101PlayInfo,
  Weiqi101WsMessage,
  Weiqi101InitData,
} from './types';

/**
 * 101围棋网 WebSocket 辅助类
 *
 * 负责通过 WebSocket 获取实时棋谱数据。
 */
export class Weiqi101WsHelper {
  /**
   * 通过 WebSocket 获取棋谱数据
   */
  async fetchViaWebSocket(
    playInfo: Weiqi101PlayInfo,
    network: { connect: (url: string, options?: unknown) => Promise<IWebSocket> },
    config: { weiqi101BaseUrl: string },
    timeout = 15000
  ): Promise<Weiqi101InitData | null> {
    const wsUrl = playInfo.sockethost || playInfo.sockethost2;
    const userkey = playInfo.userkey;
    const playId = playInfo.id;

    if (!wsUrl || !userkey || !playId) {
      return null;
    }

    const result: Weiqi101InitData = { pos: [], status: 0, stepcount: 0 };
    let ws: IWebSocket | null = null;

    try {
      ws = await network.connect(wsUrl, {
        timeout,
        headers: {
          Origin: config.weiqi101BaseUrl,
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K)',
        },
      });

      // 监听消息
      ws?.onMessage((event) => {
        try {
          const message: Weiqi101WsMessage = JSON.parse(
            event.data.toString()
          );
          const action = message.action;

          if (action === 'connected') {
            // 发送初始化消息
            const initMsg = {
              pkey: `play:${playId}`,
              cmd: 'init_user',
              userkey,
            };
            ws?.send(JSON.stringify(initMsg));

            // 稍后请求初始数据
            setTimeout(() => {
              ws?.send(JSON.stringify({ cmd: 'getinitdata' }));
            }, 300);
          } else if (action === 'initdata') {
            const data: Weiqi101InitData = JSON.parse(message.data || '{}');
            result.pos = data.pos || [];
            result.status = data.status || 0;
            result.stepcount = data.stepcount || 0;
            ws?.close();
          }
        } catch {
          // 忽略解析错误
        }
      });

      ws?.onError((error) => {
        console.error('WebSocket error:', error);
      });

      // 等待结果
      const startWait = Date.now();
      while (Date.now() - startWait < timeout) {
        if (result.pos && result.pos.length > 0) {
          ws?.close();
          return result;
        }
        await this.sleep(300);
      }

      ws?.close();
      return result.pos && result.pos.length > 0 ? result : null;
    } catch (error) {
      ws?.close();
      return null;
    }
  }

  /**
   * 简单的 sleep 函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
