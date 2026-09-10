/**
 * @fileoverview 远程棋谱抓取提供者
 * @description 通过 P2P 隧道委托远程服务端抓取棋谱，适用于纯 Web 环境
 *
 * 当隧道已连接时，Strategy 优先选中此 Provider，所有网络请求型 URL
 * 都走远程服务端执行（服务端有完整 Sniffer + 无 CORS 限制）。
 * 隧道未连接时，此 Provider 不可用，Strategy 跳过走本地 Provider。
 */

import type { IGameProvider } from '../base/IProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { RemoteFetchResponse } from './types';
import { TunnelManager } from '../../../../infrastructure/tunnel/TunnelManager';

/**
 * 远程棋谱抓取提供者
 *
 * 匹配所有 http(s):// URL（排除 archive: 等本地协议）。
 * 注册顺序最先，隧道连接时优先使用。
 */
export class RemoteGameProvider implements IGameProvider {
  readonly name = 'remote';
  readonly displayName = '远程服务';
  readonly urlPatterns = [/^https?:\/\//i];

  canHandle(url: string): boolean {
    // 匹配 http/https URL，排除 archive: 等本地协议
    return /^https?:\/\//i.test(url);
  }

  extractId(url: string): string | null {
    // 从 URL 提取唯一标识，用于缓存 key
    try {
      const u = new URL(url);
      return u.hostname + u.pathname + u.search;
    } catch {
      return url;
    }
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = Date.now();

    const manager = TunnelManager.getInstance();
    const client = await manager.getClient();

    if (!client || !client.isConnected) {
      return this.createErrorResult(url, '远程服务未连接');
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

  /**
   * 创建失败的 FetchResult
   */
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
