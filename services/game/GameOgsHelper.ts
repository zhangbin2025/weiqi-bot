/**
 * @fileoverview OGS 玩家棋谱辅助类
 *
 * 对标 GameFoxwqHelper，串联 OgsPlayerProvider 搜索 → 对局列表 → OgsProvider 下载 → 归档。
 * 新增职业棋手对局收集器：遍历职业棋手 → 按日期筛选 → 检查 AI review → 返回有 review 的棋谱 URL。
 */

import type { GameServiceResult, FetchProgressCallback } from './IGameService';
import type { FetchResult } from './providers/base/types';
import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { IGameHistoryStorage } from './IGameHistoryStorage';
import type { IGameArchiveCache } from './IGameArchiveCache';
import { OgsPlayerProvider } from './providers/ogs/OgsPlayerProvider';
import { OgsAiReviewFetcher } from './providers/ogs/OgsAiReviewFetcher';
import type { OgsPlayerGame } from './providers/ogs/types';

export interface GameOgsHelperOptions {
  network: NetworkManager;
  archiveCache?: IGameArchiveCache | undefined;
  historyStorage?: IGameHistoryStorage | undefined;
}

export class GameOgsHelper {
  private readonly network: NetworkManager;
  private readonly playerProvider: OgsPlayerProvider;
  private readonly aiReviewFetcher: OgsAiReviewFetcher;
  private readonly archiveCache?: IGameArchiveCache | undefined;
  private readonly historyStorage?: IGameHistoryStorage | undefined;

  constructor(options: GameOgsHelperOptions) {
    this.network = options.network;
    this.playerProvider = new OgsPlayerProvider(options.network);
    this.aiReviewFetcher = new OgsAiReviewFetcher();
    this.archiveCache = options.archiveCache;
    this.historyStorage = options.historyStorage;
  }

  /**
   * 获取玩家最近棋谱的 game URL 列表
   */
  async listPlayerGames(username: string, count?: number): Promise<string[]> {
    const player = await this.playerProvider.searchPlayer(username);
    if (!player) return [];

    const games = await this.playerProvider.fetchPlayerGames(player.id, count ?? 10);
    return games.map(g => `https://online-go.com/game/${g.id}`);
  }

  /**
   * 批量下载玩家棋谱
   */
  async fetchPlayerGames(
    username: string,
    count?: number,
    options?: { onProgress?: FetchProgressCallback; fetchFn?: (url: string) => Promise<GameServiceResult> }
  ): Promise<GameServiceResult[]> {
    const player = await this.playerProvider.searchPlayer(username);
    if (!player) {
      return [this.createFailedResult(username, `OGS 用户 "${username}" 未找到`)];
    }

    const games = await this.playerProvider.fetchPlayerGames(player.id, count ?? 10);
    if (games.length === 0) {
      return [this.createFailedResult(username, '该玩家没有已结束的 19×19 对局')];
    }

    const results: GameServiceResult[] = [];
    const fetchFn = options?.fetchFn;

    for (let i = 0; i < games.length; i++) {
      const game = games[i]!;
      const url = `https://online-go.com/game/${game.id}`;
      options?.onProgress?.(i + 1, games.length, String(game.id));

      if (fetchFn) {
        const result = await fetchFn(url);
        results.push(result);
      } else {
        const result = await this.fetchAndArchive(url, game);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 收集职业棋手有 AI review 的对局 URL 列表
   *
   * 策略：
   * 1. 获取 OGS 所有职业棋手（约 73 人，带缓存）
   * 2. 对每个棋手，按日期范围获取 19×19 已结束对局
   * 3. 对每盘对局，用 hasAiReview() 快速检查是否有 AI review
   * 4. 只返回有 AI review 的对局 URL，抓够 maxCount 条就停
   *
   * @param date - 日期（YYYY-MM-DD），获取该天的对局
   * @param maxCount - 最大数量，抓够就停
   * @param onProgress - 进度回调
   * @returns 有 AI review 的对局 URL 列表
   */
  async listProGamesWithAiReview(
    date: string,
    maxCount: number = 50,
    onProgress?: (current: number, total: number | null, status: string) => void
  ): Promise<string[]> {
    // 1. 获取职业棋手列表
    onProgress?.(0, null, '获取职业棋手列表...');
    const pros = await this.playerProvider.listProPlayers();
    onProgress?.(0, pros.length, `共 ${pros.length} 位职业棋手，开始扫描对局...`);

    // 日期范围：该天 00:00:00 到 23:59:59
    const dateStart = `${date}T00:00:00`;
    const dateEnd = `${date}T23:59:59`;

    const collected: string[] = [];
    let scanned = 0;

    // REST 请求函数（供 hasAiReview 使用）
    const requestFn = async (url: string): Promise<any> => {
      const resp = await this.network.request<any>({
        url,
        method: 'GET',
      });
      return resp.data;
    };

    // 2. 遍历职业棋手
    for (let i = 0; i < pros.length; i++) {
      if (collected.length >= maxCount) {
        onProgress?.(collected.length, pros.length, `已收集 ${collected.length} 盘，达到上限，停止扫描`);
        break;
      }

      const pro = pros[i]!;
      onProgress?.(collected.length, pros.length, `扫描 ${pro.username} (${i + 1}/${pros.length})，已收集 ${collected.length} 盘`);

      try {
        // 3. 获取该棋手在指定日期的对局
        const games = await this.playerProvider.fetchPlayerGamesByDate(
          pro.id,
          dateStart,
          dateEnd,
          10
        );

        // 4. 逐个检查 AI review
        for (const game of games) {
          if (collected.length >= maxCount) break;

          if (game.handicap >= 2) continue;  // 跳过让子棋
          scanned++;
          const hasReview = await this.aiReviewFetcher.hasAiReview(game.id, requestFn);

          if (hasReview) {
            collected.push(`https://online-go.com/game/${game.id}`);
          }
        }
      } catch (e) {
        console.warn(`[GameOgsHelper] Failed to scan pro ${pro.username}:`, e);
      }
    }

    onProgress?.(collected.length, pros.length, `扫描完成：共检查 ${scanned} 盘，收集 ${collected.length} 盘有 AI review`);
    return collected;
  }

  /**
   * 下载并归档（CLI 模式用）
   */
  private async fetchAndArchive(url: string, game: OgsPlayerGame): Promise<GameServiceResult> {
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
