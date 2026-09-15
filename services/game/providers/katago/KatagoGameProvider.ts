/**
 * @fileoverview KataGo 棋谱提供者（包装 KatagoArchiveProvider）
 *
 * 将 KatagoArchiveProvider 适配为 IGameProvider 接口，
 * 使其能注册到 GameProviderRegistry 并被 fetcher 标准流程使用。
 *
 * URL 格式：katago://date/YYYY-MM-DD[/index]
 * - katago://date/2026-09-14/0  → 2026-09-14 第 1 盘
 * - katago://date/2026-09-14/5  → 2026-09-14 第 6 盘
 * - katago://date/2026-09-14    → 默认第 0 盘
 *
 * 缓存：同一天的压缩包只下载一次，后续请求从内存缓存取。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming, GameMetadata } from '../base/types';
import type { KatagoArchiveProvider } from './KatagoArchiveProvider';
import type { KatagoSgfEntry } from './types';
import { parseSGF } from '../../../../domain/sgf';

/** 日期 → 棋谱列表的内存缓存 */

export class KatagoGameProvider extends BaseProvider {
  readonly name = 'katago';
  readonly displayName = 'KataGo';
  readonly urlPatterns = [
    /katago:\/\/date\/(\d{4}-\d{2}-\d{2})(?:\/(\d+))?/,
  ];

  /** 日期 → 棋谱列表的内存缓存 */
  private cache: Map<string, KatagoSgfEntry[]> = new Map();

  constructor(
    network: import('../../../../infrastructure/network/core/NetworkManager').NetworkManager,
    private readonly archiveProvider: KatagoArchiveProvider,
  ) {
    super(network);
  }

  /**
   * 获取指定日期的棋谱列表（带缓存）
   * 对外暴露，供 FetcherApp 展开列表条目
   */
  async getGamesByDate(date: string): Promise<KatagoSgfEntry[]> {
    const cached = this.cache.get(date);
    if (cached) return cached;

    const entries = await this.archiveProvider.fetchGamesByDate(date);
    this.cache.set(date, entries);
    return entries;
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    const match = url.match(/katago:\/\/date\/(\d{4}-\d{2}-\d{2})(?:\/(\d+))?/);
    if (!match) {
      return this.createErrorResult(url, '无效的 KataGo URL 格式', timing);
    }

    const date = match[1]!;
    const index = match[2] ? parseInt(match[2], 10) : 0;

    try {
      const entries = await this.getGamesByDate(date);

      if (entries.length === 0) {
        return this.createErrorResult(url, '该日期无可用棋谱', timing);
      }

      if (index >= entries.length) {
        return this.createErrorResult(url, `索引 ${index} 超出范围（共 ${entries.length} 盘）`, timing);
      }

      const entry = entries[index]!;
      const sgfContent = entry.sgfContent;

      // 从 SGF 提取元数据
      const parsed = parseSGF(sgfContent);
      const gameInfo = parsed.gameInfo;

      timing.total = this.now() - startTime;

      const metadata: GameMetadata = {
        source: this.name,
        gameId: `${date}_${index}`,
        blackName: gameInfo.black || 'KataGo',
        whiteName: gameInfo.white || 'KataGo',
        blackRank: gameInfo.blackRank || '',
        whiteRank: gameInfo.whiteRank || '',
        width: gameInfo.boardSize || 19,
        height: gameInfo.boardSize || 19,
        komi: parseFloat(gameInfo.komi) || 0,
        handicap: gameInfo.handicap ?? 0,
        rules: gameInfo.rules || 'chinese',
        date,
        result: gameInfo.result || '',
        movesCount: parsed.moves.length,
      };

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
        '下载失败: ' + (error instanceof Error ? error.message : String(error)),
        timing,
      );
    }
  }
}
