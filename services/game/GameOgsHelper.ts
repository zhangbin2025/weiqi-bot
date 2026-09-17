/**
 * @fileoverview OGS 玩家棋谱辅助类
 *
 * 对标 GameFoxwqHelper，串联 OgsPlayerProvider 搜索 → 对局列表 → OgsProvider 下载 → 归档。
 * 职业对局收集：从 OGS live games 收集活跃玩家 → 查昨天的已结束对局 → 检查 AI review。
 */

import type { GameServiceResult, FetchProgressCallback } from './IGameService';
import type { FetchResult } from './providers/base/types';
import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { IGameHistoryStorage } from './IGameHistoryStorage';
import type { IGameArchiveCache } from './IGameArchiveCache';
import { OgsPlayerProvider } from './providers/ogs/OgsPlayerProvider';
import { OgsAiReviewFetcher } from './providers/ogs/OgsAiReviewFetcher';
import { OgsLiveProvider } from './providers/ogs/OgsLiveProvider';
import type { OgsPlayerGame } from './providers/ogs/types';

export interface GameOgsHelperOptions {
  network: NetworkManager;
  archiveCache?: IGameArchiveCache | undefined;
  historyStorage?: IGameHistoryStorage | undefined;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class GameOgsHelper {
  private readonly network: NetworkManager;
  private readonly playerProvider: OgsPlayerProvider;
  private readonly aiReviewFetcher: OgsAiReviewFetcher;
  private readonly liveProvider: OgsLiveProvider;
  private readonly archiveCache?: IGameArchiveCache | undefined;
  private readonly historyStorage?: IGameHistoryStorage | undefined;

  constructor(options: GameOgsHelperOptions) {
    this.network = options.network;
    this.playerProvider = new OgsPlayerProvider(options.network);
    this.aiReviewFetcher = new OgsAiReviewFetcher();
    this.liveProvider = new OgsLiveProvider();
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
   * 收集活跃玩家有 AI review 的对局 URL 列表
   *
   * 策略：
   * 1. 通过 WebSocket 获取当前 OGS live games 的 19×19 非让子棋活跃玩家
   * 2. 对每个活跃玩家，按日期获取已结束的 19×19 ranked 非让子棋对局
   * 3. 对每盘对局检查是否有 AI review
   * 4. 只返回有 AI review 的对局 URL，抓够 maxCount 条就停
   *
   * @param date - 日期（YYYY-MM-DD），获取该天的对局
   * @param maxCount - 最大数量，抓够就停
   * @param onProgress - 进度回调
   * @returns 有 AI review 的对局 URL 列表
   */
  async listProGamesWithAiReview(
    date: string,
    maxCount: number = 20,
    onProgress?: (current: number, total: number | null, status: string) => void
  ): Promise<string[]> {
    // 1. 获取活跃玩家列表
    onProgress?.(0, null, '获取 OGS 活跃玩家...');
    const liveGames = await this.liveProvider.fetchLiveGames(100, undefined, 19);

    // 提取 19×19 非让子棋对局中的玩家 id
    const playerIds = new Set<number>();
    for (const game of liveGames) {
      // liveGames 返回的是 LatestGameItem，需要从 URL 提取 game id
      // 但我们需要玩家 id，直接用 WebSocket 获取原始数据更好
    }

    // 直接用 WebSocket 获取原始 live games（含玩家 id）
    const rawPlayers = await this.fetchLivePlayerIds(19);
    onProgress?.(0, rawPlayers.length, `获取到 ${rawPlayers.length} 位活跃玩家，开始扫描对局...`);

    // 日期范围
    const dateStart = `${date}T00:00:00`;
    const dateEnd = `${date}T23:59:59`;

    const collected: string[] = [];
    let scanned = 0;

    // REST 请求函数（带限流重试）
    const requestFn = async (url: string): Promise<any> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const resp = await this.network.request<any>({
            url,
            method: 'GET',
          });
          return resp.data;
        } catch (e: any) {
          const msg = String(e?.message || e?.response?.statusText || e);
          const status = e?.response?.status;
          if ((status === 429 || msg.includes('throttl')) && attempt < 2) {
            console.warn(`[GameOgsHelper] Throttled, retrying in 2s... (${attempt + 1}/3)`);
            await sleep(2000);
            continue;
          }
          throw e;
        }
      }
    };

    // 2. 遍历活跃玩家
    for (let i = 0; i < rawPlayers.length; i++) {
      if (collected.length >= maxCount) {
        onProgress?.(collected.length, rawPlayers.length, `已收集 ${collected.length} 盘，达到上限，停止扫描`);
        break;
      }

      const { id, username } = rawPlayers[i]!;
      onProgress?.(collected.length, rawPlayers.length, `扫描 ${username} (${i + 1}/${rawPlayers.length})，已收集 ${collected.length} 盘`);

      try {
        const games = await this.playerProvider.fetchPlayerGamesByDate(
          id,
          dateStart,
          dateEnd,
          10
        );

        // 3. 逐个检查 AI review（跳过让子棋）
        for (const game of games) {
          if (collected.length >= maxCount) break;
          if (game.handicap >= 2) continue;
          if (!game.ranked) continue;  // 只看 ranked 对局

          await sleep(300);
          scanned++;
          const hasReview = await this.aiReviewFetcher.hasAiReview(game.id, requestFn);

          if (hasReview) {
            collected.push(`https://online-go.com/game/${game.id}`);
          }
        }
      } catch (e) {
        console.warn(`[GameOgsHelper] Failed to scan player ${username}:`, e);
      }

      await sleep(500);
    }

    onProgress?.(collected.length, rawPlayers.length, `扫描完成：共检查 ${scanned} 盘，收集 ${collected.length} 盘有 AI review`);
    return collected;
  }

  /**
   * 通过 WebSocket 获取当前 live games 的 19×19 非让子棋玩家列表
   */
  private async fetchLivePlayerIds(boardSize: number = 19): Promise<Array<{ id: number; username: string; rank: number }>> {
    const { io } = await import('socket.io-client');

    return new Promise<Array<{ id: number; username: string; rank: number }>>((resolve) => {
      const socket = io('wss://online-go.com', {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        timeout: 10000,
      });

      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.disconnect();
          resolve([]);
        }
      }, 15000);

      socket.on('connect', () => {
        socket.emit('gamelist/query', {
          list: 'live',
          sort_by: 'rank',
          where: {},
          from: 0,
          limit: 100,
          channel: '',
        }, (response: any) => {
          settled = true;
          clearTimeout(timeout);
          socket.disconnect();

          const games = response?.results || [];
          const players = new Map<number, { id: number; username: string; rank: number }>();

          for (const g of games) {
            if (g.width === boardSize && g.height === boardSize && g.handicap === 0) {
              if (g.black) {
                players.set(g.black.id, { id: g.black.id, username: g.black.username, rank: g.black.rank });
              }
              if (g.white) {
                players.set(g.white.id, { id: g.white.id, username: g.white.username, rank: g.white.rank });
              }
            }
          }

          resolve(Array.from(players.values()));
        });
      });

      socket.on('connect_error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve([]);
        }
      });

      socket.on('disconnect', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve([]);
        }
      });
    });
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
