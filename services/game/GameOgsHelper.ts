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
import type { IDocumentStorage } from '../../infrastructure/storage/interfaces/IDocumentStorage';

/** OGS 活跃玩家缓存条目 */
export interface OgsPlayerCacheEntry {
  id: string;
  playerId: number;
  username: string;
  rank: number;
  lastSeen: string;
  gameCount: number;
}
import { OgsPlayerProvider } from './providers/ogs/OgsPlayerProvider';
import { OgsAiReviewFetcher } from './providers/ogs/OgsAiReviewFetcher';
import { OgsLiveProvider } from './providers/ogs/OgsLiveProvider';
import type { OgsPlayerGame } from './providers/ogs/types';

export interface GameOgsHelperOptions {
  network: NetworkManager;
  archiveCache?: IGameArchiveCache | undefined;
  historyStorage?: IGameHistoryStorage | undefined;
  playerCache?: IDocumentStorage<OgsPlayerCacheEntry> | undefined;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class GameOgsHelper {
  private readonly network: NetworkManager;
  private readonly playerProvider: OgsPlayerProvider;
  private readonly aiReviewFetcher: OgsAiReviewFetcher;
  private readonly liveProvider: OgsLiveProvider;
  private readonly archiveCache?: IGameArchiveCache | undefined;
  private readonly playerCache?: IDocumentStorage<OgsPlayerCacheEntry> | undefined;
  private readonly historyStorage?: IGameHistoryStorage | undefined;

  constructor(options: GameOgsHelperOptions) {
    this.network = options.network;
    this.playerProvider = new OgsPlayerProvider(options.network);
    this.aiReviewFetcher = new OgsAiReviewFetcher();
    this.liveProvider = new OgsLiveProvider();
    this.archiveCache = options.archiveCache;
    this.playerCache = options.playerCache;
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
   * 1. 通过 WebSocket 获取当前 OGS live games 的 19×19 非让子棋活跃玩家（按段位降序）
   * 2. 对每个活跃玩家，按日期获取已结束的 19×19 ranked 非让子棋对局
   * 3. ranked 对局自动有 AI review，无需逐盘检查
   * 4. 抓够 maxCount 条就停
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
    const dateStart = `${date}T00:00:00`;
    const dateEnd = `${date}T23:59:59`;
    const collected: string[] = [];
    const scannedPlayers = new Set<number>();  // 已扫描的玩家 id

    // --- Phase 1: 从缓存中读取已知活跃玩家，优先扫描 ---
    let cachedPlayers: Array<{ playerId: number; username: string; rank: number }> = [];
    if (this.playerCache) {
      onProgress?.(0, null, '读取活跃玩家缓存...');
      const entries = await this.playerCache.find({});
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      for (const e of entries) {
        const age = now - new Date(e.lastSeen).getTime();
        if (age < sevenDays) {
          cachedPlayers.push({
            playerId: e.playerId,
            username: e.username,
            rank: e.rank,
          });
        }
      }
      cachedPlayers.sort((a, b) => b.rank - a.rank);
      console.log(`[GameOgsHelper] 缓存命中 ${cachedPlayers.length} 位活跃玩家`);
    }

    if (cachedPlayers.length > 0) {
      onProgress?.(0, cachedPlayers.length, `从缓存扫描 ${cachedPlayers.length} 位活跃玩家...`);
      for (let i = 0; i < cachedPlayers.length; i++) {
        if (collected.length >= maxCount) break;
        const { playerId, username, rank } = cachedPlayers[i]!;
        scannedPlayers.add(playerId);

        onProgress?.(collected.length, cachedPlayers.length, `缓存扫描 ${username} (${i + 1}/${cachedPlayers.length})，已收集 ${collected.length} 盘`);

        try {
          const games = await this.playerProvider.fetchPlayerGamesByDate(playerId, dateStart, dateEnd, 10);
          console.log(`[GameOgsHelper][缓存] ${username} (rank=${Math.round(rank*100)/100}): ${games.length} 盘昨日对局`);
          const playerCollected = this.collectRankedGames(games, collected, maxCount);
          if (playerCollected > 0) {
            console.log(`[GameOgsHelper][缓存] ${username}: 收集 ${playerCollected} 盘，总计 ${collected.length}/${maxCount}`);
            await this.updatePlayerCache(playerId, username, rank, date, playerCollected);
          }
        } catch (e) {
          console.warn(`[GameOgsHelper] Failed to scan cached player ${username}:`, e);
        }
        await sleep(500);
      }
    }

    // --- Phase 2: 缓存不够，从 live games 补充 ---
    if (collected.length < maxCount) {
      onProgress?.(collected.length, null, '缓存不足，获取 OGS live games 补充...');
      const livePlayers = await this.fetchLivePlayerIds(19);
      livePlayers.sort((a, b) => b.rank - a.rank);
      console.log(`[GameOgsHelper] live games 获取 ${livePlayers.length} 位玩家，已扫 ${scannedPlayers.size} 位`);

      for (let i = 0; i < livePlayers.length; i++) {
        if (collected.length >= maxCount) break;
        const { id, username, rank } = livePlayers[i]!;
        if (scannedPlayers.has(id)) continue;  // 跳过已扫描的

        onProgress?.(collected.length, livePlayers.length, `live 扫描 ${username} (${i + 1}/${livePlayers.length})，已收集 ${collected.length} 盘`);

        try {
          const games = await this.playerProvider.fetchPlayerGamesByDate(id, dateStart, dateEnd, 10);
          console.log(`[GameOgsHelper][live] ${username} (rank=${Math.round(rank*100)/100}): ${games.length} 盘昨日对局`);
          const playerCollected = this.collectRankedGames(games, collected, maxCount);
          if (playerCollected > 0) {
            console.log(`[GameOgsHelper][live] ${username}: 收集 ${playerCollected} 盘，总计 ${collected.length}/${maxCount}`);
            await this.updatePlayerCache(id, username, rank, date, playerCollected);
          }
        } catch (e) {
          console.warn(`[GameOgsHelper] Failed to scan live player ${username}:`, e);
        }
        await sleep(500);
      }
    }

    onProgress?.(collected.length, null, `扫描完成：收集 ${collected.length} 盘`);
    console.log(`[GameOgsHelper] 扫描完成：收集 ${collected.length} 盘`);
    return collected;
  }

  /** 从对局列表中收集 ranked 非让子棋对局，返回收集数量 */
  private collectRankedGames(games: any[], collected: string[], maxCount: number): number {
    let count = 0;
    for (const game of games) {
      if (collected.length >= maxCount) break;
      if (game.handicap >= 2) continue;
      if (!game.ranked) continue;
      collected.push(`https://online-go.com/game/${game.id}`);
      count++;
    }
    return count;
  }

  /** 更新玩家缓存（有则更新，无则插入） */
  private async updatePlayerCache(playerId: number, username: string, rank: number, date: string, gameCount: number): Promise<void> {
    if (!this.playerCache) return;
    try {
      const id = String(playerId);
      const existing = await this.playerCache.findById(id);
      if (existing) {
        await this.playerCache.update(id, {
          username, rank, lastSeen: date, gameCount,
        });
      } else {
        await this.playerCache.insert({
          id, playerId, username, rank, lastSeen: date, gameCount,
        });
      }
    } catch (e) {
      console.warn(`[GameOgsHelper] Failed to update player cache for ${username}:`, e);
    }
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
