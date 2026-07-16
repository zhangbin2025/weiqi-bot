/**
 * @fileoverview 手谈提供者实现
 *
 * 纯 REST API 实现，无需 Playwright。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IShoutanProvider } from './IShoutanProvider';
import type { ShoutanApiResponse } from './types';
import { parseYamlData, generateSgf } from './ShoutanParser';

/**
 * 手谈 API URL
 */
const SHOUTAN_API_URL = 'https://v.dzqzd.com/Kifu/Details';

/**
 * 手谈提供者
 */
export class ShoutanProvider extends BaseProvider implements IShoutanProvider {
  readonly name = 'shoutan';
  readonly displayName = '手谈';
  readonly urlPatterns = [
    /dzqzd\.com.*[?&]kifuId=(\d+)/,
    /v\.dzqzd\.com.*[?&]kifuId=(\d+)/,
  ];

  async fetchByKifuId(kifuId: string): Promise<ShoutanApiResponse> {
    const url = `${SHOUTAN_API_URL}?kifuid=${kifuId}`;
    // 通过 NetworkManager.request()，让策略层选择 ProxyProvider
    const response = await this.network.request({
      url,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Accept': 'application/json',
        'Referer': `https://v.dzqzd.com/Kifu/chessmanualdetail?kifuId=${kifuId}`,
        'Origin': 'https://v.dzqzd.com',
      },
    });
    return response.data as ShoutanApiResponse;
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    const kifuId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!kifuId) {
      return this.createErrorResult(url, '无法从 URL 提取 kifuId', timing);
    }

    try {
      // 直接下载，不缓存
      const fetchStart = this.now();
      const apiResponse = await this.fetchByKifuId(kifuId);
      timing.apiRequest = this.now() - fetchStart;

      if (apiResponse.code !== 1) {
        return this.createErrorResult(
          url,
          apiResponse.msg || 'API 返回错误',
          timing
        );
      }

      const parseStart = this.now();
      const { gameInfo, moves } = parseYamlData(apiResponse.data);
      const sgfContent = generateSgf(gameInfo, moves);
      timing.sgfGeneration = this.now() - parseStart;

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata: {
          source: this.name,
          gameId: kifuId,
          blackName: gameInfo.blackName || '黑棋',
          whiteName: gameInfo.whiteName || '白棋',
          width: parseInt(gameInfo.boardSize, 10) || 19,
          height: parseInt(gameInfo.boardSize, 10) || 19,
          komi: 6.5,
          handicap: 0,
          rules: 'chinese',
          date: gameInfo.date || '',
          result: gameInfo.resultSgf || '',
          movesCount: moves.length,
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