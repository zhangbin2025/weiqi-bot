/**
 * @fileoverview 野狐分享链接提供者
 * @description 实现 IGameProvider，从分享链接 URL 提取 chessid 并下载棋谱
 * 
 * 支持两种模式：
 * 1. API 模式：适用于已结束的历史棋谱（快速，约 0.1 秒）
 * 2. Sniffer 模式：适用于直播中的棋谱（需要 Playwright，约 15 秒）
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import { FoxwqChessProvider } from './FoxwqChessProvider';
import { FoxwqPublicProvider } from './FoxwqPublicProvider';
import { FoxwqLiveProvider } from './FoxwqLiveProvider';

/**
 * 野狐分享链接提供者
 *
 * 支持的 URL 格式：
 * - 分享链接：http://h5.foxwq.com/yehunewshare/?chessid=xxx
 * - 公开棋谱：https://www.foxwq.com/qipu/newlist/id/xxx.html
 * - 直播棋谱：http://h5.foxwq.com/yehunewshare/?...&svrtype=20010
 */
export class FoxwqShareProvider extends BaseProvider {
  readonly name = 'foxwq';
  readonly displayName = '野狐围棋';
  readonly urlPatterns = [
    /foxwq\.com/i,
    /h5\.foxwq\.com/i,
    /share\.foxwq\.com/i,
    /cloud\.foxwq\.com/i,
  ];

  private readonly chessProvider: FoxwqChessProvider;
  private readonly publicProvider: FoxwqPublicProvider;
  private readonly liveProvider?: FoxwqLiveProvider;

  constructor(
    network: NetworkManager,
    snifferProvider?: ISnifferProvider
  ) {
    super(network);
    this.chessProvider = new FoxwqChessProvider(network);
    this.publicProvider = new FoxwqPublicProvider(network);
    if (snifferProvider) {
      this.liveProvider = new FoxwqLiveProvider(network, snifferProvider);
    }
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    try {
      const chessId = this.extractChessId(url);

      // 步骤 1：尝试 API 模式（历史棋谱）
      if (chessId) {
        console.log(`[FoxwqShareProvider] 尝试 API 模式获取棋谱: ${chessId}`);
        const apiResult = await this.tryFetchViaApi(chessId, url, timing, startTime);
        if (apiResult) {
          return apiResult;
        }
      }

      // 步骤 2：尝试公开棋谱模式
      if (url.includes('qipu')) {
        console.log(`[FoxwqShareProvider] 尝试公开棋谱模式`);
        const detail = await this.publicProvider.fetchPublicQipuSgf(url);
        if (detail.sgf) {
          const metadata = this.parseSgfMetadata(detail.sgf);
          timing.total = this.now() - startTime;
          return {
            success: true,
            source: this.name,
            url,
            sgfContent: detail.sgf,
            metadata,
            timing,
          };
        }
      }

      // 步骤 3：尝试 Sniffer 模式（直播棋谱）
      if (this.liveProvider && this.isLiveUrl(url)) {
        console.log(`[FoxwqShareProvider] 尝试 Sniffer 模式获取直播棋谱`);
        const liveResult = await this.liveProvider.fetch(url);
        if (liveResult.success) {
          // 合并 timing
          timing.total = this.now() - startTime;
          liveResult.timing = { ...liveResult.timing, ...timing };
          return liveResult;
        }
      }

      // 所有方式都失败
      return this.createErrorResult(
        url,
        '下载失败: 无法获取棋谱内容（可能需要 Sniffer 支持）',
        timing
      );
    } catch (error) {
      return this.createErrorResult(
        url,
        `下载失败: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }
  }

  /**
   * 尝试通过 API 获取棋谱
   */
  private async tryFetchViaApi(
    chessId: string,
    url: string,
    timing: PerformanceTiming,
    startTime: number
  ): Promise<FetchResult | null> {
    try {
      const sgf = await this.chessProvider.fetchSGF(chessId);
      if (sgf) {
        console.log(`[FoxwqShareProvider] API 模式成功`);
        const metadata = this.parseSgfMetadata(sgf);
        timing.total = this.now() - startTime;
        return {
          success: true,
          source: this.name,
          url,
          sgfContent: sgf,
          metadata,
          timing,
        };
      }
    } catch (error) {
      console.log(`[FoxwqShareProvider] API 模式失败: ${error}`);
    }
    return null;
  }

  /**
   * 判断是否为直播 URL
   */
  private isLiveUrl(url: string): boolean {
    // 直播类型标识
    if (url.includes('svrtype=20010')) {
      return true;
    }
    // 其他直播标识
    if (url.includes('roomid=') || url.includes('golive')) {
      return true;
    }
    return false;
  }

  private extractChessId(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const chessId = urlObj.searchParams.get('chessid');
      return chessId ?? null;
    } catch {
      const match = url.match(/chessid=([a-zA-Z0-9]+)/);
      return match && match[1] ? match[1] : null;
    }
  }

  private parseSgfMetadata(sgf: string): GameMetadata {
    const getTag = (tag: string): string => {
      const match = sgf.match(new RegExp(`${tag}\\[([^\\]]*)\\]`));
      return match ? match[1]! : '';
    };

    return {
      source: this.name,
      gameId: getTag('GC') || '',
      blackName: getTag('PB') || '黑方',
      whiteName: getTag('PW') || '白方',
      width: parseInt(getTag('SZ') || '19', 10),
      height: parseInt(getTag('SZ') || '19', 10),
      komi: parseFloat(getTag('KM') || '6.5'),
      handicap: parseInt(getTag('HA') || '0', 10),
      rules: getTag('RU') || 'chinese',
      date: getTag('DT') || '',
      result: getTag('RE') || '',
      movesCount: this.countMoves(sgf),
    };
  }

  private countMoves(sgf: string): number {
    const matches = sgf.match(/[BW]\[[^\]]*\]/g);
    return matches ? matches.length : 0;
  }
}
