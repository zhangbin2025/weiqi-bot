/**
 * @fileoverview Game 抓取辅助类
 */

import type { GameServiceResult } from './IGameService';
import type { FetchResult, GameMetadata } from './providers/base/types';
import type { IGameStrategy } from './GameStrategy';
import type { GameProviderRegistry } from './GameProviderRegistry';
import type { IGameHistoryStorage } from './IGameHistoryStorage';
import type { IGameArchiveCache } from './IGameArchiveCache';
import type { IUserContext } from '../../infrastructure/network/interfaces/IUserContext';
import { createUnsupportedResult, createErrorResult } from './GameServiceHelpers';

export interface GameFetchHelperOptions {
  registry: GameProviderRegistry;
  strategy: IGameStrategy;
  archiveCache?: IGameArchiveCache | undefined;
  historyStorage?: IGameHistoryStorage | undefined;
  userContext?: IUserContext | undefined;
}

export class GameFetchHelper {
  constructor(private readonly options: GameFetchHelperOptions) {}

  async fetch(url: string): Promise<GameServiceResult> {
    const { registry, strategy, archiveCache, historyStorage, userContext } = this.options;

    // 1. 查缓存
    const cacheKey = this.computeCacheKey(url);
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
          url,
          metadata: record.metadata as unknown as FetchResult['metadata'],
          fromCache: true,
        };
      }
    }

    // 2. 选择 Provider 并下载
    const provider = await strategy.selectProvider(url, registry.getProviders(), userContext);
    if (!provider) {
      const unsupported = createUnsupportedResult(url);
      return this.createFailedResult(url, unsupported);
    }

    let result: FetchResult;
    try {
      result = await provider.fetch(url);
    } catch (error) {
      const errorResult = createErrorResult(url, error);
      return this.createFailedResult(url, errorResult);
    }

    if (!result.success || !result.sgfContent) {
      return this.createFailedResult(url, result);
    }

    // 3. 归档
    const archiveId = await this.archive(result);

    // 4. 更新缓存
    if (archiveId) {
      await archiveCache?.set(cacheKey, archiveId);
    }

    return {
      success: true,
      archiveId,
      sgfContent: result.sgfContent,
      source: result.source,
      url,
      metadata: result.metadata as GameMetadata,
      fromCache: false,
    };
  }

  async fetchMany(urls: string[]): Promise<GameServiceResult[]> {
    return Promise.all(urls.map(url => this.fetch(url)));
  }

  private computeCacheKey(url: string): string {
    return url.replace(/[^a-zA-Z0-9]/g, '_');
  }

  private createFailedResult(url: string, result: FetchResult): GameServiceResult {
    return {
      success: false,
      archiveId: '',
      sgfContent: null,
      source: result.source,
      url,
      metadata: result.metadata as GameMetadata,
      fromCache: false,
      error: result.error,
    };
  }

  private async archive(result: FetchResult): Promise<string> {
    const { historyStorage } = this.options;
    if (!historyStorage || !result.sgfContent) return '';

    try {
      const archiveResult = await historyStorage.archive({
        gameId: result.metadata.gameId,
        type: 'sgf',
        content: result.sgfContent,
        source: result.source,
        metadata: result.metadata as unknown as Record<string, unknown>,
      });
      return archiveResult.id;
    } catch {
      return '';
    }
  }
}
