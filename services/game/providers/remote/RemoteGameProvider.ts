/**
 * @fileoverview 远程棋谱抓取提供者
 * @description 通过 P2P 隧道委托远程服务端抓取棋谱
 *
 * 仅匹配 Sniffer 依赖型 URL（纯 Web 环境下本地无法抓取的平台）。
 * REST API 型 URL 不匹配，走本地代理。
 *
 * fetch 时通过 ensureConnected() 等待隧道连接就绪（与 KataGoRemoteAdapter 一致），
 * 连上后发 RPC 请求到远程服务端执行抓取。
 */

import type { IGameProvider } from '../base/IProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { RemoteFetchResponse } from './types';
import { TunnelManager } from '../../../../infrastructure/tunnel/TunnelManager';
import type { TunnelClient } from '../../../../infrastructure/tunnel/TunnelClient';

/** 隧道连接超时（毫秒） */
const TUNNEL_CONNECT_TIMEOUT = 30_000;

/**
 * Sniffer 依赖型 URL 模式
 * 纯 Web 环境下本地无法抓取的平台，走远程服务端
 */
const SNIFFER_URL_PATTERNS = [
  // txwq
  /txwq\.qq\.com/i,
  /h5\.txwq\.qq\.com/i,
  // yike 直播 (room)
  /yikeweiqi\.com.*room\//i,
  // yike online-game
  /yikeweiqi\.com.*online-game\//i,
  // weiqi1919 / golaxy
  /19x19\.com/i,
  /golaxy/i,
  // xinboduiyi
  /xinboduiyi\.com/i,
  // yike-shaoer
  /shaoer\.yikeweiqi\.com/i,
  // foxwq 直播（含 svrid= 参数的分享链接）
  /foxwq\.com.*svrid=/i,
];

/**
 * 远程棋谱抓取提供者
 *
 * 仅匹配 Sniffer 依赖型 URL，注册顺序最后（兜底）。
 * fetch 时等待隧道连接就绪后发 RPC 请求。
 */
export class RemoteGameProvider implements IGameProvider {
  readonly name = 'remote';
  readonly displayName = '远程服务';
  readonly urlPatterns = SNIFFER_URL_PATTERNS;

  canHandle(url: string): boolean {
    return SNIFFER_URL_PATTERNS.some(p => p.test(url));
  }

  extractId(url: string): string | null {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname + u.search;
    } catch {
      return url;
    }
  }

  /**
   * 等待隧道连接就绪
   * 与 KataGoRemoteAdapter.ensureConnected() 模式一致
   */
  private async ensureConnected(): Promise<TunnelClient> {
    const client = await TunnelManager.getInstance().getClient();
    if (client && client.isConnected) {
      return client;
    }
    // getClient 可能因超时返回 null，再等一次
    throw new Error('远程隧道未连接，请在设置中开启客户端模式');
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = Date.now();

    let client: TunnelClient;
    try {
      client = await this.ensureConnected();
    } catch (error) {
      return this.createErrorResult(url, error instanceof Error ? error.message : '隧道连接失败');
    }

    try {
      const result = await client.call('fetcher', 'fetch', { url }) as RemoteFetchResponse;

      timing.total = Date.now() - startTime;

      if (!result || !result.success) {
        return this.createErrorResult(
          url,
          result?.error || '远程抓取失败',
          timing
        );
      }

      return {
        success: true,
        source: result.source || this.name,
        url,
        sgfContent: result.sgfContent,
        metadata: result.metadata as GameMetadata,
        timing,
      };
    } catch (error) {
      return this.createErrorResult(
        url,
        `远程抓取异常: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }
  }

  private createErrorResult(
    url: string,
    error: string,
    timing?: PerformanceTiming
  ): FetchResult {
    return {
      success: false,
      source: this.name,
      url,
      sgfContent: null,
      metadata: {
        source: this.name,
        gameId: '',
        blackName: '',
        whiteName: '',
        width: 19,
        height: 19,
        komi: 6.5,
        handicap: 0,
        rules: '',
        date: '',
        movesCount: 0,
      },
      error,
      timing,
    };
  }
}
