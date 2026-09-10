/**
 * @fileoverview 远程棋谱抓取提供者
 */

import type { IGameProvider } from '../base/IProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { RemoteFetchResponse } from './types';
import { TunnelManager } from '../../../../infrastructure/tunnel/TunnelManager';
import type { TunnelClient } from '../../../../infrastructure/tunnel/TunnelClient';

const SNIFFER_URL_PATTERNS = [
  /txwq\.qq\.com/i,
  /h5\.txwq\.qq\.com/i,
  /yikeweiqi\.com.*room\//i,
  /yikeweiqi\.com.*online-game\//i,
  /19x19\.com/i,
  /golaxy/i,
  /xinboduiyi\.com/i,
  /shaoer\.yikeweiqi\.com/i,
  /foxwq\.com.*svrid=/i,
];

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

  private async ensureConnected(): Promise<TunnelClient> {
    const manager = TunnelManager.getInstance();

    if (!manager.isClientMode()) {
      console.warn('[RemoteGameProvider] not in client mode');
      throw new Error('未配置客户端模式，请在设置中开启远程隧道');
    }

    console.info('[RemoteGameProvider] waiting for tunnel connection...');

    // 先触发连接（如果还没开始）
    const client = await manager.getClient();

    if (client && client.isConnected) {
      console.info('[RemoteGameProvider] tunnel already connected');
      return client;
    }

    // getClient 可能因超时返回 null，但隧道可能还在后台连
    // 轮询等待连接完成，最多再等 30 秒
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const c = manager.getClientSync();
      if (c?.isConnected) {
        console.info('[RemoteGameProvider] tunnel connected after', (i + 1) * 0.5, 's');
        return c;
      }
    }

    console.warn('[RemoteGameProvider] tunnel connection timeout');
    throw new Error('远程隧道连接超时，请检查网络和远程服务端');
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = Date.now();

    console.info('[RemoteGameProvider] fetch started:', url.substring(0, 80));

    let client: TunnelClient;
    try {
      client = await this.ensureConnected();
    } catch (error) {
      const msg = error instanceof Error ? error.message : '隧道连接失败';
      console.warn('[RemoteGameProvider] tunnel not connected:', msg);
      return this.createErrorResult(url, msg);
    }

    console.info('[RemoteGameProvider] tunnel connected, sending RPC...');

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
