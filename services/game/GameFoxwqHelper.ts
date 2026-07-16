/**
 * @fileoverview 野狐围棋特定操作辅助类
 */

import type { GameServiceResult, FetchProgressCallback } from './IGameService';
import type { FetchResult } from './providers/base/types';
import type { GameProviderRegistry } from './GameProviderRegistry';
import type { IGameHistoryStorage } from './IGameHistoryStorage';
import type { IGameArchiveCache } from './IGameArchiveCache';
import type { FoxwqGame } from './providers/foxwq/types';

export interface GameFoxwqHelperOptions {
  registry: GameProviderRegistry;
  archiveCache?: IGameArchiveCache | undefined;
  historyStorage?: IGameHistoryStorage | undefined;
}

export class GameFoxwqHelper {
  constructor(private readonly options: GameFoxwqHelperOptions) {}

  async listPlayerGames(player: string, count?: number): Promise<string[]> {
    const foxwq = this.options.registry.getFoxwqProvider();
    if (!foxwq) return [];

    try {
      const user = await foxwq.queryUserByName(player);
      const games = await foxwq.fetchChessList(user.uid);
      return games.slice(0, count ?? 5).map((g: FoxwqGame) => g.chessid);
    } catch {
      return [];
    }
  }

  async listPublicGames(date?: string, count?: number): Promise<string[]> {
    const foxwq = this.options.registry.getFoxwqProvider();
    if (!foxwq) return [];

    try {
      const qipuList = await foxwq.fetchPublicQipuList(date);
      return qipuList.slice(0, count ?? 10).map(q => q.url);
    } catch {
      return [];
    }
  }

  async fetchByChessIds(
    chessids: string[],
    options?: { onProgress?: FetchProgressCallback }
  ): Promise<GameServiceResult[]> {
    const foxwq = this.options.registry.getFoxwqProvider();
    if (!foxwq) {
      return chessids.map(id => this.createFailedResult(id, '野狐提供者未注册'));
    }

    const results: GameServiceResult[] = [];
    for (let i = 0; i < chessids.length; i++) {
      const id = chessids[i]!;
      options?.onProgress?.(i + 1, chessids.length, id);
      const result = await this.fetchSingleChess(id);
      results.push(result);
    }
    return results;
  }

  private async fetchSingleChess(chessid: string): Promise<GameServiceResult> {
    const { registry, archiveCache, historyStorage } = this.options;
    const foxwq = registry.getFoxwqProvider()!;

    // 检查缓存
    const cacheKey = `foxwq_chess_${chessid}`;
    const cachedArchiveId = await archiveCache?.get(cacheKey);

    if (cachedArchiveId && historyStorage) {
      const record = await historyStorage.findById(cachedArchiveId);
      if (record) {
        const content = await historyStorage.readContent(record.path);
        return {
          success: true,
          archiveId: cachedArchiveId,
          sgfContent: typeof content === 'string' ? content : null,
          source: record.source,
          url: `foxwq://chess/${chessid}`,
          metadata: record.metadata as unknown as FetchResult['metadata'],
          fromCache: true,
        };
      }
    }

    // 下载 SGF
    try {
      const sgfContent = await foxwq.fetchSGF(chessid);
      if (!sgfContent) {
        return this.createFailedResult(chessid, 'SGF 内容为空');
      }

      // 归档
      const archiveId = await this.archiveSgf(chessid, sgfContent);
      if (archiveId) {
        await archiveCache?.set(cacheKey, archiveId);
      }

      return {
        success: true,
        archiveId,
        sgfContent,
        source: 'foxwq',
        url: `foxwq://chess/${chessid}`,
        metadata: this.createMetadata(chessid, sgfContent),
        fromCache: false,
      };
    } catch (error) {
      return this.createFailedResult(
        chessid,
        error instanceof Error ? error.message : '下载失败'
      );
    }
  }

  private async archiveSgf(chessid: string, sgfContent: string): Promise<string> {
    const { historyStorage } = this.options;
    if (!historyStorage) return '';

    try {
      const result = await historyStorage.archive({
        gameId: chessid,
        type: 'sgf',
        content: sgfContent,
        source: 'foxwq',
        metadata: this.createMetadata(chessid, sgfContent) as unknown as Record<string, unknown>,
      });
      return result.id;
    } catch {
      return '';
    }
  }

  private createMetadata(chessid: string, sgfContent: string): FetchResult['metadata'] {
    // 从 SGF 内容中提取元数据
    let blackName = '';
    let whiteName = '';
    let date = '';
    let result = '';

    try {
      const pbMatch = sgfContent.match(/PB\[([^\]]*)\]/);
      const pwMatch = sgfContent.match(/PW\[([^\]]*)\]/);
      const dtMatch = sgfContent.match(/DT\[([^\]]*)\]/);
      const reMatch = sgfContent.match(/RE\[([^\]]*)\]/);
      if (pbMatch) blackName = pbMatch[1]!;
      if (pwMatch) whiteName = pwMatch[1]!;
      if (dtMatch) date = dtMatch[1]!;
      if (reMatch) result = reMatch[1]!;
    } catch (e) {
      // 解析失败，保持空字符串
    }

    return {
      source: 'foxwq',
      gameId: chessid,
      blackName,
      whiteName,
      width: 19,
      height: 19,
      komi: 6.5,
      handicap: 0,
      rules: '',
      date,
      result,
      movesCount: sgfContent.split(/[A-Z][A-Z]/).length - 1,
    };
  }

  private createFailedResult(chessid: string, error: string): GameServiceResult {
    return {
      success: false,
      archiveId: '',
      sgfContent: null,
      source: 'foxwq',
      url: `foxwq://chess/${chessid}`,
      metadata: {
        source: 'foxwq',
        gameId: chessid,
        blackName: '',
        whiteName: '',
        width: 19,
        height: 19,
        komi: 6.5,
        handicap: 0,
        rules: '',
        date: '',
        movesCount: 0,
      },
      fromCache: false,
      error,
    };
  }
}
