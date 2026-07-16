/**
 * @fileoverview 弈城围棋提供者实现
 *
 * 纯 REST API 实现，无需 Playwright。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IYichengProvider } from './IYichengProvider';
import { parseGameData, generateSgf } from './YichengParser';

/**
 * 弈城围棋 API URL
 */
const YICHENG_API_URL = 'http://client.eweiqi.com/gibo/gibo_load_data.php';

/**
 * 弈城围棋提供者
 */
export class YichengProvider extends BaseProvider implements IYichengProvider {
  readonly name = 'yicheng';
  readonly displayName = '弈城围棋';
  readonly urlPatterns = [
    /eweiqi\.com.*GNO=(\d+)/,
    /eweiqi\.com.*id=(\d+)/,
  ];

  async fetchByGameId(gameId: string): Promise<string> {
    const url = `${YICHENG_API_URL}?id=${gameId}&mode=my`;
    const response = await this.network.fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K)' },
    });
    return response.text();
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    const gameId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!gameId) {
      return this.createErrorResult(url, '无法从 URL 提取游戏 ID', timing);
    }

    try {
      // 直接下载，不缓存
      const fetchStart = this.now();
      const data = await this.fetchByGameId(gameId);
      timing.apiRequest = this.now() - fetchStart;

      const parseStart = this.now();
      const parsed = parseGameData(data);
      const sgfContent = generateSgf(parsed);
      timing.sgfGeneration = this.now() - parseStart;

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata: {
          source: this.name,
          gameId,
          blackName: parsed.blackName,
          whiteName: parsed.whiteName,
          blackRank: parsed.blackRank,
          whiteRank: parsed.whiteRank,
          width: 19,
          height: 19,
          komi: 6.5,
          handicap: 0,
          rules: 'chinese',
          date: parsed.date,
          movesCount: parsed.moves.length,
        },
        timing,
      };
    } catch (error) {
      return this.createErrorResult(
        url,
        `获取棋谱失败: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }
  }
}