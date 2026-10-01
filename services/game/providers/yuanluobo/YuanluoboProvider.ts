/**
 * @fileoverview 元萝卜提供者实现
 *
 * 纯 REST API 实现，通过 NetworkManager.request() 自动使用代理解决 CORS。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IYuanluoboProvider } from './IYuanluoboProvider';
import type { YuanluoboApiResponse } from './types';
import { SGFWriter } from '../../../../domain/sgf';
import type { MoveOrPass } from '../../../../domain/move';

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
  private readonly sgfWriter = new SGFWriter();
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
      const sgfContent = this.generateSgf(gameInfo, moves, gameData.recording?.fen);

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
          komi: gameInfo.handicap > 0 ? 0 : 6.5,
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
   * 生成 SGF 内容（使用 domain/sgf 接口）
   *
   * 让子棋处理：
   * 元萝卜 API 通过 recording.fen 字段返回初始局面，从中提取让子位置。
   * fen 格式：每行用数字+字母表示，如 "3b11b3" 表示第4行位置3和15有黑子。
   */
  private generateSgf(
    info: { blackName: string; whiteName: string; handicap: number },
    moves: Array<{ color: string; coord: string }>,
    fen?: string
  ): string {
    // 从 fen 解析让子位置
    const handicapStones = info.handicap > 0 && fen
      ? this.parseHandicapStonesFromFen(fen)
      : [];

    const moveOrPass: MoveOrPass[] = moves.map((m, i) => ({
      x: m.coord.charCodeAt(0) - 97,
      y: m.coord.charCodeAt(1) - 97,
      color: m.color === 'B' ? 'black' : 'white',
      number: i + 1,
    }));

    return this.sgfWriter.write(moveOrPass, {
      size: 19,
      blackName: info.blackName,
      whiteName: info.whiteName,
      handicap: info.handicap > 0 ? info.handicap : undefined,
      handicapStones: handicapStones.length > 0 ? handicapStones : undefined,
      komi: info.handicap > 0 ? 0 : 6.5,
      rules: 'chinese',
    });
  }

  /**
   * 从 fen 解析让子位置
   *
   * fen 格式：用 / 分隔每行，数字表示连续空位，b/w 表示棋子
   * 注意：fen 的 x 轴是镜像的（与 SGF 相反），需转换：sgf_x = 18 - fen_x
   * y 轴直接对应行索引（0-based）
   *
   * 例："19/19/19/3b11b3/..." → 第4行(y=3) fen_x=3 和 fen_x=15 有黑子
   *       → sgf (18-3, 3)=(15,3) 和 (18-15, 3)=(3,3) → pd 和 dd
   */
  private parseHandicapStonesFromFen(fen: string): Array<{ x: number; y: number; color: 'B' }> {
    const stones: Array<{ x: number; y: number; color: 'B' }> = [];
    const rows = fen.split('/');

    for (let y = 0; y < rows.length && y < 19; y++) {
      const row = rows[y];
      if (!row) continue;

      let fenX = 0;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]!;
        if (ch >= '0' && ch <= '9') {
          let num = parseInt(ch, 10);
          while (i + 1 < row.length) {
            const nextCh = row[i + 1]!;
            if (nextCh < '0' || nextCh > '9') break;
            i++;
            num = num * 10 + parseInt(nextCh, 10);
          }
          fenX += num;
        } else if (ch === 'b') {
          // fen x 轴镜像：sgf_x = 18 - fen_x
          const sgfX = 18 - fenX;
          stones.push({ x: sgfX, y, color: 'B' });
          fenX++;
        } else {
          // w 或其他字符
          fenX++;
        }
      }
    }

    return stones;
  }
}