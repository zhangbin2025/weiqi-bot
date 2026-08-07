/**
 * @fileoverview 101围棋网提供者实现
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IWeiqi101Provider } from './IWeiqi101Provider';
import type { Weiqi101PlayInfo } from './types';
import { Weiqi101WsHelper } from './Weiqi101WsHelper';
import { Weiqi101SgfGenerator } from './Weiqi101SgfGenerator';
import { Weiqi101Parser } from './Weiqi101Parser';

/** 101围棋网基础 URL */
const WEIQI101_BASE_URL = 'https://www.101weiqi.com';

/**
 * 101围棋网提供者
 */
export class Weiqi101Provider extends BaseProvider implements IWeiqi101Provider {
  readonly name = 'weiqi101';
  readonly displayName = '101围棋网';
  readonly urlPatterns = [
    /101weiqi\.com\/play\/p\/(\d+)/,
    /101weiqi\.com\/play\/(\d+)/,
    /101weiqi\.cn\/play\/p\/(\d+)/,
    /101weiqi\.cn\/play\/(\d+)/,
  ];

  private readonly wsHelper = new Weiqi101WsHelper();
  private readonly sgfGenerator = new Weiqi101SgfGenerator();
  private readonly parser = new Weiqi101Parser();

  async fetchById(playId: string): Promise<FetchResult> {
    const url = `https://www.101weiqi.com/play/p/${playId}/`;
    return this.fetch(url);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    const playId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!playId) {
      return this.createErrorResult(url, '无法从 URL 提取对局 ID', timing);
    }

    try {
      // 直接下载，不缓存
      const pageStart = this.now();
      const pageUrl = `${WEIQI101_BASE_URL}/play/p/${playId}/`;

      const response = await this.network.request<string>({
        url: pageUrl,
        method: 'GET',
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      const html = response.data;
      const playInfo = this.parser.extractPlayInfo(html);

      if (!playInfo) {
        return this.createErrorResult(url, '无法从页面提取对局数据', timing);
      }

      timing.apiRequest = this.now() - pageStart;

      // 尝试 WebSocket 获取完整数据
      const result = await this.handleWebSocketFallback(playInfo, playId, url, timing);
      timing.total = this.now() - startTime;
      return result;
    } catch (error) {
      return this.createErrorResult(
        url,
        `下载失败: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }
  }

  /**
   * 尝试 WebSocket，失败则回退到页面数据
   */
  private async handleWebSocketFallback(
    playInfo: Weiqi101PlayInfo,
    playId: string,
    url: string,
    timing: PerformanceTiming
  ): Promise<FetchResult> {
    try {
      const wsStart = this.now();
      const wsData = await this.wsHelper.fetchViaWebSocket(
        playInfo, { connect: (url: string, opts?: unknown) => this.network.connect(url, opts as any) } as any, { weiqi101BaseUrl: 'https://www.101weiqi.com' }
      );
      timing.sgfGeneration = this.now() - wsStart;

      if (wsData && wsData.pos) {
        const metadata = this.parser.parseMetadata(
          playInfo, playId, this.name, wsData
        );
        const sgfStart = this.now();
        const sgfContent = this.sgfGenerator.generate(wsData.pos, metadata);
        timing.sgfGeneration = (timing.sgfGeneration || 0) + (this.now() - sgfStart);

        return {
          success: true,
          source: this.name,
          url,
          sgfContent,
          metadata,
        };
      }
    } catch {
      // WebSocket 失败，回退到页面数据
    }

    // 回退：使用页面数据
    const metadata = this.parser.parseMetadata(playInfo, playId, this.name);
    const sgfContent = this.sgfGenerator.generate(playInfo.points || [], metadata);

    return {
      success: true,
      source: this.name,
      url,
      sgfContent,
      metadata,
    };
  }
}