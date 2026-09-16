/**
 * @fileoverview OGS 玩家棋谱辅助类
 *
 * 对标 GameFoxwqHelper，串联 OgsPlayerProvider 搜索 → 对局列表 → OgsProvider 下载 → 归档。
 */

import type { GameServiceResult, FetchProgressCallback } from './IGameService';
import type { FetchResult } from './providers/base/types';
import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { IGameHistoryStorage } from './IGameHistoryStorage';
import type { IGameArchiveCache } from './IGameArchiveCache';
import { OgsPlayerProvider } from './providers/ogs/OgsPlayerProvider';
import type { OgsPlayerGame } from './providers/ogs/types';

export interface GameOgsHelperOptions {
  network: NetworkManager;
  archiveCache?: IGameArchiveCache | undefined;
  historyStorage?: IGameHistoryStorage | undefined;
}

export class GameOgsHelper {
  private readonly playerProvider: OgsPlayerProvider;
  private readonly archiveCache?: IGameArchiveCache | undefined;
  private readonly historyStorage?: IGameHistoryStorage | undefined;

  constructor(options: GameOgsHelperOptions) {
    this.playerProvider = new OgsPlayerProvider(options.network);
    this.archiveCache = options.archiveCache;
    this.historyStorage = options.historyStorage;
  }

  /**
   * 获取玩家最近棋谱的 game URL 列表
   *
   * @param username - OGS 用户名（精确匹配）
   * @param count - 最大数量
   * @returns game URL 列表（如 https://online-go.com/game/{id}）
   */
  async listPlayerGames(username: string, count?: number): Promise<string[]> {
    const player = await this.playerProvider.searchPlayer(username);
    if (!player) return [];

    const games = await this.playerProvider.fetchPlayerGames(player.id, count ?? 10);
    return games.map(g => `https://online-go.com/game/${g.id}`);
  }

  /**
   * 批量下载玩家棋谱
   *
   * @param username - OGS 用户名（精确匹配）
   * @param count - 最大数量
   * @param options - 进度回调
   * @returns 下载结果列表
   */
  async fetchPlayerGames(
    username: string,
    count?: number,
    options?: { onProgress?: FetchProgressCallback; fetchFn?: (url: string) => Promise<GameServiceResult> }
  ): Promise<GameServiceResult[]> {
    // 1. 搜索玩家
    const player = await this.playerProvider.searchPlayer(username);
    if (!player) {
      return [this.createFailedResult(username, `OGS 用户 "${username}" 未找到`)];
    }

    // 2. 获取对局列表
    const games = await this.playerProvider.fetchPlayerGames(player.id, count ?? 10);
    if (games.length === 0) {
      return [this.createFailedResult(username, '该玩家没有已结束的 19×19 对局')];
    }

    // 3. 逐个下载（通过外部 fetchFn 或自行归档）
    const results: GameServiceResult[] = [];
    const fetchFn = options?.fetchFn;

    for (let i = 0; i < games.length; i++) {
      const game = games[i]!;
      const url = `https://online-go.com/game/${game.id}`;
      options?.onProgress?.(i + 1, games.length, String(game.id));

      if (fetchFn) {
        // Web 模式：由 GameService.fetch 处理下载+归档
        const result = await fetchFn(url);
        results.push(result);
      } else {
        // CLI 模式：自行归档（需要 historyStorage）
        const result = await this.fetchAndArchive(url, game);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 下载并归档（CLI 模式用）
   */
  private async fetchAndArchive(url: string, game: OgsPlayerGame): Promise<GameServiceResult> {
    // 这里简化处理：实际下载由上层 GameService.fetch 完成
    // GameOgsHelper 只负责串联流程，归档交给 GameService
    return {
      success: false,
      archiveId: '',
      sgfContent: null,
      source: 'ogs',
      url,
      metadata: {
        source: 'ogs',
        gameId: String(game.id),
        blackName: game.players.black.username,
        whiteName: game.players.white.username,
        width: game.width,
        height: game.height,
        komi: parseFloat(game.komi) || 6.5,
        handicap: game.handicap,
        rules: '',
        date: game.ended?.substring(0, 10) ?? '',
        result: this.formatResult(game),
        movesCount: 0,
      },
      fromCache: false,
      error: 'fetchAndArchive should be called with fetchFn',
    };
  }

  /**
   * 格式化结果
   */
  private formatResult(game: OgsPlayerGame): string {
    if (!game.outcome) return '';
    const winner = game.black_lost ? 'W' : 'B';
    if (game.outcome === 'Resignation') return `${winner}+R`;
    if (game.outcome === 'Timeout') return `${winner}+T`;
    const pointsMatch = game.outcome.match(/^([\d.]+)\s*points?$/i);
    if (pointsMatch) return `${winner}+${pointsMatch[1]}`;
    return game.outcome;
  }

  private createFailedResult(username: string, error: string): GameServiceResult {
    return {
      success: false,
      archiveId: '',
      sgfContent: null,
      source: 'ogs',
      url: '',
      metadata: {
        source: 'ogs',
        gameId: username,
        blackName: '',
        whiteName: '',
        width: 19,
        height: 19,
        komi: 6.5,
        handicap: 0,
        rules: '',
        date: '',
        result: '',
        movesCount: 0,
      },
      fromCache: false,
      error,
    };
  }
}
