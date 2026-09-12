/**
 * @fileoverview Game 抓取辅助类
 */

import type { GameServiceResult } from "./IGameService";
import type { FetchResult, GameMetadata } from "./providers/base/types";
import type { IGameStrategy } from "./GameStrategy";
import type { GameProviderRegistry } from "./GameProviderRegistry";
import type { IGameHistoryStorage } from "./IGameHistoryStorage";
import type { IGameArchiveCache } from "./IGameArchiveCache";
import type { IUserContext } from "../../infrastructure/network/interfaces/IUserContext";
import { createUnsupportedResult, createErrorResult } from "./GameServiceHelpers";
import { parseSGF } from "../../domain/sgf";

export interface GameFetchHelperOptions {
  registry: GameProviderRegistry;
  strategy: IGameStrategy;
  archiveCache?: IGameArchiveCache | undefined;
  historyStorage?: IGameHistoryStorage | undefined;
  userContext?: IUserContext | undefined;
  /** 最大并发数，默认 3 */
  maxConcurrency?: number;
  /** 请求间隔（毫秒），默认 200ms */
  requestDelay?: number;
}

export class GameFetchHelper {
  private readonly maxConcurrency: number;
  private readonly requestDelay: number;

  constructor(private readonly options: GameFetchHelperOptions) {
    this.maxConcurrency = options.maxConcurrency ?? 3;
    this.requestDelay = options.requestDelay ?? 200;
  }

  async fetch(url: string, forceRefresh?: boolean, timeout?: number): Promise<GameServiceResult> {
    const { registry, strategy, archiveCache, historyStorage, userContext } = this.options;
    console.info('[GameFetchHelper] fetch called, forceRefresh:', forceRefresh, 'url:', url.substring(0, 80));

    // 1. 直播 URL 不使用缓存（棋谱会更新）
    const isLiveUrl = this.isLiveUrl(url);

    // 2. 查缓存（forceRefresh 时跳过，直播 URL 也跳过）
    if (!forceRefresh && !isLiveUrl) {
      const cacheKey = this.computeCacheKey(url);
      const cachedArchiveId = await archiveCache?.get(cacheKey);

      if (cachedArchiveId && historyStorage) {
        const record = await historyStorage.findById(cachedArchiveId);
        if (record) {
          const content = await historyStorage.readContent(record.path);
          return {
            success: true,
            archiveId: cachedArchiveId,
            sgfContent: typeof content === "string" ? content : null,
            source: record.source,
            url,
            metadata: record.metadata as unknown as FetchResult["metadata"],
            fromCache: true,
          };
        }
      }
    }

    // 3. 选择 Provider 并下载
    const provider = await strategy.selectProvider(url, registry.getProviders(), userContext);
    if (!provider) {
      const unsupported = createUnsupportedResult(url);
      return this.createFailedResult(url, unsupported);
    }

    let result: FetchResult;
    try {
      result = await (provider as any).fetch(url, timeout ? { timeout } : undefined);
    } catch (error) {
      const errorResult = createErrorResult(url, error);
      return this.createFailedResult(url, errorResult);
    }

    if (!result.success || !result.sgfContent) {
      return this.createFailedResult(url, result);
    }

    // 4. 手数 fallback：如果 Provider 未提取到手数，用 domain 层 parseSGF 解析主线
    if (result.metadata.movesCount === 0) {
      const parsed = parseSGF(result.sgfContent);
      if (parsed.moves.length > 0) {
        console.info("[GameFetchHelper] movesCount fallback: 0 -> " + parsed.moves.length + " (via parseSGF)");
        result.metadata.movesCount = parsed.moves.length;
      }
    }

    // 5. 归档
    const archiveId = await this.archive(result);

    // 6. 更新缓存
    if (archiveId) {
      const cacheKey = this.computeCacheKey(url);
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

  /**
   * 批量获取棋谱（限制并发数）
   */
  async fetchMany(urls: string[]): Promise<GameServiceResult[]> {
    const results: GameServiceResult[] = new Array(urls.length);
    let currentIndex = 0;
    const activeTasks: Promise<void>[] = [];

    const worker = async (): Promise<void> => {
      while (currentIndex < urls.length) {
        const index = currentIndex++;
        const url = urls[index];
        if (!url) continue;
        if (index > 0 && this.requestDelay > 0) {
          await this.delay(this.requestDelay);
        }
        results[index] = await this.fetch(url);
      }
    };

    for (let i = 0; i < Math.min(this.maxConcurrency, urls.length); i++) {
      activeTasks.push(worker());
    }

    await Promise.all(activeTasks);
    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private computeCacheKey(url: string): string {
    return url.replace(/[^a-zA-Z0-9]/g, "_");
  }

  private createFailedResult(url: string, result: FetchResult): GameServiceResult {
    return {
      success: false,
      archiveId: "",
      sgfContent: null,
      source: result.source,
      url,
      metadata: result.metadata as GameMetadata,
      fromCache: false,
      error: result.error,
    };
  }

  private sanitizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      if (urlObj.searchParams.has("title")) {
        urlObj.searchParams.delete("title");
        return urlObj.toString();
      }
    } catch {
    }
    return url;
  }

  private async archive(result: FetchResult): Promise<string> {
    const { historyStorage } = this.options;
    if (!historyStorage || !result.sgfContent) return "";
    try {
      const archiveResult = await historyStorage.archive({
        gameId: result.metadata.gameId,
        type: "sgf",
        content: result.sgfContent,
        source: result.source,
        metadata: { ...(result.metadata as unknown as Record<string, unknown>), url: this.sanitizeUrl(result.url) },
      });
      return archiveResult.id;
    } catch {
      return "";
    }
  }

  private isLiveUrl(url: string): boolean {
    const livePatterns = [
      /izis\.cn.*gameId=/i,
      /h5\.foxwq\.com.*svrtype=20010/i,
      /h5\.foxwq\.com.*roomid=/i,
      /yikeweiqi\.com.*room\/\d+/i,
      /online-go\.com\/game\/\d+/i,
    ];
    return livePatterns.some(p => p.test(url));
  }
}
