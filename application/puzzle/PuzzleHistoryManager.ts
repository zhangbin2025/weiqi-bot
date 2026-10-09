/**
 * 做题历史管理器
 * @description 管理做题历史的增删查改、导入导出、统计（复用 ActivityLogService）
 */
import type { IActivityLogService, ActivityEntry, ActivityStats } from '../../services/activity';

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
  success: boolean;
  /** 本题尝试次数（答错重做的累计次数） */
  attempts: number;
  /** 用户实际落子手数 */
  moves: number;
  /** 耗时（毫秒） */
  duration: number;
  solvedAt: number;
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
  success: boolean;
  attempts: number;
  moves: number;
  duration: number;
}

/** 活动日志中的做题类型标识 */
export const PUZZLE_ACTIVITY_TYPE = 'puzzle';

/**
 * 做题历史管理器
 */
export class PuzzleHistoryManager {
  constructor(private readonly activityLogService?: IActivityLogService) {}

  /** 记录做题结果 */
  async record(result: PuzzleResult): Promise<string | undefined> {
    return this.activityLogService?.record(
      PUZZLE_ACTIVITY_TYPE,
      `做题：${result.success ? '成功' : '失败'} ${result.title}`.trim(),
      {
        url: result.url,
        title: result.title,
        source: result.source,
        tag: result.tag,
        success: result.success,
        attempts: result.attempts,
        moves: result.moves,
        duration: result.duration,
      },
      ['做题', result.source, result.tag, result.success ? '成功' : '失败'].filter(Boolean) as string[],
    );
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
