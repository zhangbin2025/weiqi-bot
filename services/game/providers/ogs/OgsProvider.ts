/**
 * @fileoverview OGS (Online-Go.com) 提供者实现
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { IOgsProvider } from './IOgsProvider';
import type { OgsGameResponse } from './types';
import { OgsSgfGenerator } from './OgsSgfGenerator';

/**
 * OGS API 基础 URL
 */
const OGS_API_URL = 'https://api.online-go.com/api/v1';

/**
 * OGS 提供者
 *
 * 支持从 OGS (Online-Go.com) 下载棋谱。
 * 纯 REST API 实现，无需 Playwright。
 *
 * URL 格式：
 * - https://online-go.com/game/{GAME_ID}
 * - https://online-go.com/game/view/{GAME_ID}
 */
export class OgsProvider extends BaseProvider implements IOgsProvider {
  readonly name = 'ogs';
  readonly displayName = 'OGS (Online-Go)';
  readonly urlPatterns = [
    /online-go\.com\/game\/(\d+)/,
    /online-go\.com\/game\/view\/(\d+)/,
  ];

  private readonly sgfGenerator = new OgsSgfGenerator();

  /**
   * 通过游戏 ID 获取游戏数据
   */
  async fetchById(gameId: string): Promise<FetchResult> {
    const url = `https://online-go.com/game/${gameId}`;
    return this.fetch(url);
  }

  /**
   * 下载棋谱
   */
  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    // 1. 提取 ID
    const gameId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!gameId) {
      return this.createErrorResult(url, '无法从 URL 提取游戏 ID', timing);
    }

    try {
      // 2. 调用 API
      const apiStart = this.now();
      const apiUrl = `${OGS_API_URL}/games/${gameId}`;

      const response = await this.network.request<OgsGameResponse>({
        url: apiUrl,
        method: 'GET',
      });

      timing.apiRequest = this.now() - apiStart;

      if (!response.data) {
        return this.createErrorResult(url, 'API 响应为空', timing);
      }

      // 3. 解析数据并生成 SGF
      const metadata = this.parseMetadata(response.data, gameId);
      const sgfStart = this.now();
      const sgfContent = this.sgfGenerator.generate(response.data, metadata);
      timing.sgfGeneration = this.now() - sgfStart;

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
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

  /**
   * 解析元数据
   */
  private parseMetadata(data: OgsGameResponse, gameId: string): GameMetadata {
    const players = data.players || {};
    const black = players.black || {};
    const white = players.white || {};
    const gamedata = data.gamedata || {};

    let result = '';
    if (data.outcome) {
      result = data.outcome;
    } else if (data.ended) {
      if (data.black_lost && !data.white_lost) {
        result = 'W+Resign';
      } else if (data.white_lost && !data.black_lost) {
        result = 'B+Resign';
      }
    }

    return {
      source: this.name,
      gameId,
      blackName: black.username || 'Black',
      whiteName: white.username || 'White',
      blackRank: this.formatRank(black.ranking),
      whiteRank: this.formatRank(white.ranking),
      width: gamedata.width || 19,
      height: gamedata.height || 19,
      komi: gamedata.komi || 6.5,
      handicap: gamedata.handicap || 0,
      rules: gamedata.rules || 'japanese',
      date: data.started ? data.started.substring(0, 10) : '',
      result,
      movesCount: (gamedata.moves || []).length,
    };
  }

  /**
   * 格式化段位
   * OGS rating 约 100-50k, 1500-2100d (段位)
   */
  private formatRank(ranking?: number): string {
    if (ranking === undefined || ranking === null) {
      return '';
    }
    if (ranking < 100) {
      return `${Math.floor(30 - ranking / 100)}k`;
    }
    const dan = Math.floor((ranking - 100) / 100);
    return `${dan + 1}d`;
  }
}