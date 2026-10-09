/**
 * 做题历史管理器
 * @description 管理做题历史的记录、查询、统计（复用 ActivityLogService）。
 *              同一题目（按 URL）只保留一条记录：重复做会累加次数并合并结果，
 *              只要解出过一次即为「已解出」。
 */
import type { IActivityLogService, ActivityEntry, ActivityStats } from '../../services/activity';

/** 初始局面摆子 */
export interface PuzzleInitialStone {
  x: number;
  y: number;
  color: 'black' | 'white';
}

/** 做题历史查询选项 */
export interface PuzzleHistoryOptions {
  keyword?: string;
  limit?: number;
  offset?: number;
}

/** 做题历史条目 */
export interface PuzzleHistoryEntry {
  id: string;
  /** 题目 URL（内置题库为 lib://...，在线题为原始链接） */
  url: string;
  /** 题目标题（内置题库为 #序号，在线题为题名） */
  title: string;
  /** 来源标识：lib-life-death / weiqi101 / goproblems / ogs-puzzle */
  source: string;
  /** 题目标签（内置题库为「类型·难度」，如 死活题·5D） */
  tag: string;
  /** 是否曾解出（做过但没解出为 false） */
  success: boolean;
  /** 本题累计做过次数 */
  attempts: number;
  /** 最近一次的用户落子手数 */
  moves: number;
  /** 最近一次耗时（毫秒） */
  duration: number;
  /** 最近一次做题时间（毫秒时间戳） */
  solvedAt: number;
  /** 棋盘路数，用于缩略图还原 */
  boardSize: number;
  /** 题目初始局面摆子，用于渲染缩略图 */
  initialStones: PuzzleInitialStone[];
}

/** 做题统计 */
export interface PuzzleStats {
  total: number;
  success: number;
  failed: number;
  today: number;
  /** 平均耗时（毫秒），无记录为 0 */
  avgDuration: number;
}

/** 做题结果（用于记录） */
export interface PuzzleResult {
  url: string;
  title: string;
  source: string;
  tag: string;
  /** 本次是否解出 */
  success: boolean;
  attempts: number;
  moves: number;
  duration: number;
  /** 棋盘路数，用于缩略图还原 */
  boardSize: number;
  /** 题目初始局面摆子，用于渲染缩略图 */
  initialStones: PuzzleInitialStone[];
}

/** 活动日志中的做题类型标识 */
export const PUZZLE_ACTIVITY_TYPE = 'puzzle';

/**
 * 做题历史管理器
 */
export class PuzzleHistoryManager {
  constructor(private readonly activityLogService?: IActivityLogService) {}

  /**
   * 记录一次做题
   *
   * 同一题目（URL 相同）合并为一条记录：
   * - 次数累加，最近信息（手数/耗时/时间）刷新
   * - 只要解出过一次，success 保持 true
   * - 缩略图数据（路数/摆子）缺失时补齐
   */
  async record(result: PuzzleResult): Promise<string | undefined> {
    if (!this.activityLogService) return undefined;

    const existing = await this.findByUrl(result.url);
    const tags = ['做题', result.source, result.tag].filter(Boolean) as string[];

    if (existing) {
      const prevSuccess = (existing.data['success'] as boolean) ?? false;
      const prevAttempts = (existing.data['attempts'] as number) ?? 0;
      const prevStones = (existing.data['initialStones'] as PuzzleInitialStone[]) ?? [];
      const prevSize = (existing.data['boardSize'] as number) ?? 0;
      const success = prevSuccess || result.success;
      const data: Record<string, unknown> = {
        ...existing.data,
        title: result.title || existing.data['title'],
        tag: result.tag || existing.data['tag'],
        source: result.source || existing.data['source'],
        success,
        attempts: prevAttempts + Math.max(1, result.attempts),
        moves: result.moves,
        duration: result.duration,
        boardSize: prevSize || result.boardSize,
        initialStones: prevStones.length > 0 ? prevStones : result.initialStones,
      };
      // 更新时间戳，让最近做过的题排在最前
      await this.activityLogService.update?.(existing.id, {
        data,
        ...(tags.length > 0 ? { tags } : {}),
        createdAt: Date.now(),
      });
      return existing.id;
    }

    return this.activityLogService.record(
      PUZZLE_ACTIVITY_TYPE,
      `做题：${result.title}`.trim(),
      {
        url: result.url,
        title: result.title,
        source: result.source,
        tag: result.tag,
        success: result.success,
        attempts: Math.max(1, result.attempts),
        moves: result.moves,
        duration: result.duration,
        boardSize: result.boardSize,
        initialStones: result.initialStones,
      },
      tags,
    );
  }

  /** 按题目 URL 查找已有记录 */
  private async findByUrl(url: string): Promise<ActivityEntry | null> {
    if (!url) return null;
    const entries = (await this.activityLogService?.query({
      type: PUZZLE_ACTIVITY_TYPE,
      limit: 1000,
    })) ?? [];
    return entries.find((e) => e.data['url'] === url) ?? null;
  }

  /** 查询做题历史 */
  async query(options?: PuzzleHistoryOptions): Promise<PuzzleHistoryEntry[]> {
    if (!this.activityLogService) return [];
    const entries = await this.activityLogService.query({
      type: PUZZLE_ACTIVITY_TYPE,
      keyword: options?.keyword,
      limit: options?.limit ?? 20,
      offset: options?.offset,
    });
    return entries.map((e: ActivityEntry) => ({
      id: e.id,
      url: (e.data['url'] as string) ?? '',
      title: (e.data['title'] as string) ?? '',
      source: (e.data['source'] as string) ?? '',
      tag: (e.data['tag'] as string) ?? '',
      success: (e.data['success'] as boolean) ?? false,
      attempts: (e.data['attempts'] as number) ?? 0,
      moves: (e.data['moves'] as number) ?? 0,
      duration: (e.data['duration'] as number) ?? 0,
      solvedAt: e.createdAt,
      boardSize: (e.data['boardSize'] as number) ?? 19,
      initialStones: (e.data['initialStones'] as PuzzleInitialStone[]) ?? [],
    }));
  }

  /** 获取单条历史详情 */
  async getDetail(id: string): Promise<ActivityEntry | null> {
    return this.activityLogService?.getById(id) ?? null;
  }

  /** 获取统计信息 */
  async getStats(): Promise<PuzzleStats> {
    const stats = (await this.activityLogService?.stats()) ?? ({ total: 0, today: 0 } as ActivityStats);
    const entries = (await this.activityLogService?.query({ type: PUZZLE_ACTIVITY_TYPE, limit: 1000 })) ?? [];
    let success = 0;
    let failed = 0;
    let durationSum = 0;
    for (const e of entries) {
      if (e.data['success'] as boolean) success++;
      else failed++;
      durationSum += (e.data['duration'] as number) ?? 0;
    }
    return {
      total: entries.length,
      success,
      failed,
      today: stats.today,
      avgDuration: entries.length > 0 ? Math.round(durationSum / entries.length) : 0,
    };
  }

  /** 导入历史 */
  async importHistory(json: string): Promise<number> {
    const data = JSON.parse(json) as PuzzleResult[];
    let count = 0;
    for (const item of data) {
      await this.record(item);
      count++;
    }
    return count;
  }

  /** 导出历史 */
  async exportHistory(): Promise<string> {
    const entries = await this.query({ limit: 10000 });
    return JSON.stringify(entries, null, 2);
  }

  /** 清空历史 */
  async clearHistory(): Promise<void> {
    await this.activityLogService?.clear(PUZZLE_ACTIVITY_TYPE);
  }
}
