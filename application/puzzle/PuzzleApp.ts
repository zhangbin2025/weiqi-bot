/**
 * 做题应用编排器
 * @module application/puzzle/PuzzleApp
 * @description 组合 GameService / FetcherApp 完成题目列表获取、题目 SGF 抓取，
 *              并通过 PuzzleHistoryManager 记录做题历史。
 */
import type { IGameService } from '../../services/game/IGameService';
import type { IActivityLogService } from '../../services/activity';
import type { LatestGameItem } from '../fetcher/types';
import type { FetcherApp } from '../fetcher/FetcherApp';
import { PuzzleHistoryManager, PuzzleHistoryEntry, PuzzleHistoryOptions, PuzzleStats, PuzzleResult } from './PuzzleHistoryManager';

export type {
  PuzzleHistoryEntry,
  PuzzleHistoryOptions,
  PuzzleStats,
  PuzzleResult,
};

/** 支持的题目来源 */
export type PuzzleSource = 'lib-life-death' | 'weiqi101' | 'goproblems' | 'ogs-puzzle';

/** 来源显示名 */
export const PUZZLE_SOURCE_LABELS: Record<PuzzleSource, string> = {
  'lib-life-death': '内置题库',
  'weiqi101': '101围棋',
  'goproblems': 'GoProblems',
  'ogs-puzzle': 'OGS死活题',
};

/** 默认来源（内置题库，离线可用） */
export const DEFAULT_PUZZLE_SOURCE: PuzzleSource = 'lib-life-death';

/** 题目条目（列表展示用，对齐 LatestGameItem） */
export interface PuzzleItem {
  /** 抓取 URL */
  url: string;
  /** 标题（内置题库为 #序号，在线题为题名） */
  title: string;
  /** 副标题（内置题库为「类型·难度」） */
  subtitle?: string | undefined;
  date: string;
  source: PuzzleSource;
}

/**
 * 做题应用编排器
 */
export class PuzzleApp {
  private historyManager: PuzzleHistoryManager;

  constructor(
    private readonly gameService?: IGameService,
    private readonly fetcherApp?: FetcherApp,
    activityLogService?: IActivityLogService,
  ) {
    this.historyManager = new PuzzleHistoryManager(activityLogService);
  }

  /**
   * 获取题目列表
   * @param source - 题目来源
   * @param count - 数量
   * @param keyword - 筛选关键字（内置题库支持 and/or 表达式，如 "(官子 or 死活) and 2D"）
   */
  async listPuzzles(source: PuzzleSource, count: number = 30, keyword?: string): Promise<PuzzleItem[]> {
    if (!this.fetcherApp) return [];
    const items: LatestGameItem[] = await this.fetcherApp.fetchLatestGames(source, count, keyword);
    return items.map((it) => ({
      url: it.url,
      title: it.title,
      subtitle: it.subtitle,
      date: it.date,
      source,
    }));
  }

  /**
   * 抓取题目 SGF 内容
   * @param url - 题目 URL（lib://... 或 https://...）
   * @returns SGF 文本，失败返回 null
   */
  async fetchPuzzleSGF(url: string): Promise<string | null> {
    if (!this.gameService) return null;
    const result = await this.gameService.fetch(url);
    if (!result.success) {
      console.warn('[PuzzleApp] 抓题失败', { url, error: result.error });
      return null;
    }
    return result.sgfContent;
  }

  // ========== 历史管理（委托给 PuzzleHistoryManager） ==========

  /** 记录做题结果 */
  async recordResult(result: PuzzleResult): Promise<string | undefined> {
    return this.historyManager.record(result);
  }

  /** 查询做题历史 */
  async queryHistory(options?: PuzzleHistoryOptions): Promise<PuzzleHistoryEntry[]> {
    return this.historyManager.query(options);
  }

  /** 获取历史详情 */
  async getHistoryDetail(id: string) {
    return this.historyManager.getDetail(id);
  }

  /** 获取统计信息 */
  async getStats(): Promise<PuzzleStats> {
    return this.historyManager.getStats();
  }

  /** 导入历史 */
  async importHistory(json: string): Promise<number> {
    return this.historyManager.importHistory(json);
  }

  /** 导出历史 */
  async exportHistory(): Promise<string> {
    return this.historyManager.exportHistory();
  }

  /** 清空历史 */
  async clearHistory(): Promise<void> {
    await this.historyManager.clearHistory();
  }
}
