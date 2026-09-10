/**
 * @fileoverview 棋谱抓取 RPC 处理器
 * @description 服务端处理器：接收远程 fetch 请求，委托给本地 GameService 执行
 *
 * 支持的 RPC 方法：
 * - fetch: 从 URL 抓取棋谱
 */

import type { IRpcHandler, TunnelService } from './types';
import type { IGameService } from '../../services/game/IGameService';

/**
 * 棋谱抓取 RPC 处理器
 *
 * 在服务端注册，客户端通过 tunnel.call('fetcher', 'fetch', { url }) 调用。
 * 服务端利用本地完整的 Sniffer + 无 CORS 环境抓取棋谱。
 */
export class FetcherRpcHandler implements IRpcHandler {
  readonly serviceName: TunnelService = 'fetcher';

  constructor(private gameService: IGameService) {}

  async handle(method: string, params: unknown): Promise<unknown> {
    if (method === 'fetch') {
      const { url } = params as { url: string };
      const result = await this.gameService.fetch(url);

      return {
        success: result.success,
        sgfContent: result.sgfContent,
        source: result.source,
        metadata: result.metadata,
        error: result.error,
      };
    }

    throw new Error(`Unknown method: ${method}`);
  }
}
