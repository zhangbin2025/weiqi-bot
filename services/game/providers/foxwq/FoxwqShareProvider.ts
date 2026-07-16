/**
 * @fileoverview 野狐分享链接提供者
 * @description 实现 IGameProvider，从分享链接 URL 提取 chessid 并下载棋谱
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import { FoxwqChessProvider } from './FoxwqChessProvider';
import { FoxwqPublicProvider } from './FoxwqPublicProvider';

/**
 * 野狐分享链接提供者
 *
 * 支持的 URL 格式：
 * - 分享链接：http://h5.foxwq.com/yehunewshare/?chessid=xxx
 * - 公开棋谱：https://www.foxwq.com/qipu/newlist/id/xxx.html
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

  constructor(network: NetworkManager) {
    super(network);
    this.chessProvider = new FoxwqChessProvider(network);
    this.publicProvider = new FoxwqPublicProvider(network);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    try {
      let sgf: string;
      const chessId = this.extractChessId(url);

      if (chessId) {
        sgf = await this.chessProvider.fetchSGF(chessId);
      } else if (url.includes('qipu')) {
        const detail = await this.publicProvider.fetchPublicQipuSgf(url);
        sgf = detail.sgf;
      } else {
        return this.createErrorResult(url, '无法识别的野狐链接格式', timing);
      }

      if (!sgf) {
        return this.createErrorResult(url, '棋谱内容为空', timing);
      }

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
    } catch (error) {
      return this.createErrorResult(
        url,
        `下载失败: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }
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
