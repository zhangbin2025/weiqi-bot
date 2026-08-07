/**
 * @fileoverview 元萝卜提供者实现
 *
 * 纯 REST API 实现，通过 NetworkManager.request() 自动使用代理解决 CORS。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IYuanluoboProvider } from './IYuanluoboProvider';
import type { YuanluoboApiResponse } from './types';

/**
 * 元萝卜 API URL
 */
const YUANLUOBO_API_URL = 'https://jupiter.yuanluobo.com/r2/chess/wq/sdr/v3/record/detail';

/**
 * 元萝卜提供者
 *
 * URL 格式：
 * - https://jupiter.yuanluobo.com/robot-public/all-in-app/go/review?session_id={ID}
 */
export class YuanluoboProvider extends BaseProvider implements IYuanluoboProvider {
  readonly name = 'yuanluobo';
  readonly displayName = '元萝卜';
  readonly urlPatterns = [
    /yuanluobo\.com.*session_id=([A-Za-z0-9]+)/,
    /jupiter\.yuanluobo\.com.*session_id=([A-Za-z0-9]+)/,
  ];

  /**
   * 通过 session_id 获取棋谱数据
   * 使用 NetworkManager.request() 自动通过代理解决 CORS
   */
  async fetchBySessionId(sessionId: string): Promise<string> {
    const response = await this.network.request({
      url: YUANLUOBO_API_URL,
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Referer': `https://jupiter.yuanluobo.com/robot-public/all-in-app/go/review?session_id=${sessionId}`,
        'Origin': 'https://jupiter.yuanluobo.com',
      },
      data: { sessionId },
    });
    return JSON.stringify(response.data);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    // 1. 提取 session_id
    const sessionId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!sessionId) {
      return this.createErrorResult(url, '无法从 URL 提取 session_id', timing);
    }

    try {
      // 通过 NetworkManager.request() 自动使用代理解决 CORS
      const fetchStart = this.now();
      const response = await this.network.request<YuanluoboApiResponse>({
        url: YUANLUOBO_API_URL,
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Referer': `https://jupiter.yuanluobo.com/robot-public/all-in-app/go/review?session_id=${sessionId}`,
          'Origin': 'https://jupiter.yuanluobo.com',
        },
        data: { sessionId },
      });
      timing.apiRequest = this.now() - fetchStart;

      const apiResponse = response.data;

      if (apiResponse.code !== 100000) {
        return this.createErrorResult(
          url,
          apiResponse.message || 'API 返回错误',
          timing
        );
      }

      const gameData = apiResponse.data;

      // 解析数据
      const parseStart = this.now();
      const gameInfo = this.parseGameInfo(gameData);
      const moves = this.parseMoves(gameData);
      timing.sgfGeneration = this.now() - parseStart;

      // 生成 SGF
      const sgfContent = this.generateSgf(gameInfo, moves);

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata: {
          source: this.name,
          gameId: sessionId,
          blackName: gameInfo.blackName || '黑棋',
          whiteName: gameInfo.whiteName || '白棋',
          blackRank: '',
          whiteRank: '',
          width: 19,
          height: 19,
          komi: 6.5,
          handicap: gameInfo.handicap,
          rules: 'chinese',
          date: '',
          result: '',
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

  /**
   * 解析游戏信息
   */
  private parseGameInfo(data: YuanluoboApiResponse['data']): {
    blackName: string;
    whiteName: string;
    handicap: number;
  } {
    return {
      blackName: data.black_player_name || '黑棋',
      whiteName: data.white_player_name || '白棋',
      handicap: data.handicap || 0,
    };
  }

  /**
   * 解析着法
   */
  private parseMoves(data: YuanluoboApiResponse['data']): Array<{ color: string; coord: string }> {
    const moves: Array<{ color: string; coord: string }> = [];
    const rawMoves = data.recording?.moves || [];

    for (const move of rawMoves) {
      const coord = move.coordinate || '';
      const match = coord.match(/^([BW])\[([a-z]{2})\]$/);
      if (match) {
        moves.push({
          color: match[1]!,
          coord: match[2]!,
        });
      }
    }

    return moves;
  }

  /**
   * 生成 SGF 内容
   */
  private generateSgf(
    info: { blackName: string; whiteName: string; handicap: number },
    moves: Array<{ color: string; coord: string }>
  ): string {
    const parts: string[] = [];
    parts.push('(;GM[1]FF[4]CA[UTF-8]');
    parts.push('SZ[19]');
    parts.push(`PB[${info.blackName}]`);
    parts.push(`PW[${info.whiteName}]`);

    if (info.handicap > 0) {
      parts.push(`HA[${info.handicap}]`);
    }

    for (const move of moves) {
      parts.push(`;${move.color}[${move.coord}]`);
    }

    parts.push(')');
    return parts.join('');
  }
}