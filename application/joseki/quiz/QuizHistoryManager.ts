/**
 * 定式挑战历史管理器
 * @description 管理挑战历史的增删查改、导入导出、统计
 */
import type { IActivityLogService, ActivityEntry, ActivityStats } from '../../../services/activity';
/** 挑战历史查询选项 */
export interface QuizHistoryOptions {
  keyword?: string;
  limit?: number;
  offset?: number;
}
/** 挑战历史条目 */
export interface QuizHistoryEntry {
  id: string;
  path: string[];
  difficulty: string;
  success: boolean;
  attempts: number;
  challengedAt: number;
  color?: 'black' | 'white';
  freq?: number;
  prob?: number;
}
/** 挑战统计 */
export interface QuizStats {
  total: number;
  success: number;
  failed: number;
  today: number;
}
/** 挑战结果（用于记录） */
export interface ChallengeResult {
  path: string[];
  difficulty: string;
  success: boolean;
  attempts: number;
}
/**
 * 定式挑战历史管理器
 */
export class QuizHistoryManager {
  constructor(private readonly activityLogService?: IActivityLogService) {}
  /** 记录挑战结果 */
  async recordChallenge(result: ChallengeResult): Promise<string | undefined> {
    return this.activityLogService?.record(
      'quiz',
      `定式挑战：${result.success ? '成功' : '失败'}`,
      { path: result.path, difficulty: result.difficulty, success: result.success, attempts: result.attempts },
      ['定式挑战', result.difficulty],
    );
  }
  /** 查询挑战历史 */
  async queryHistory(options?: QuizHistoryOptions): Promise<QuizHistoryEntry[]> {
    if (!this.activityLogService) return [];
    const entries = await this.activityLogService.query({
      type: 'quiz',
      keyword: options?.keyword,
      limit: options?.limit ?? 20,
      offset: options?.offset,
    });
    return entries.map((e: ActivityEntry) => ({
      id: e.id,
      path: (e.data['path'] as string[]) ?? [],
      difficulty: (e.data['difficulty'] as string) ?? '',
      success: (e.data['success'] as boolean) ?? false,
      attempts: (e.data['attempts'] as number) ?? 0,
      challengedAt: e.createdAt,
    }));
  }
  /** 获取单条历史详情 */
  async getHistoryDetail(id: string): Promise<ActivityEntry | null> {
    return this.activityLogService?.getById(id) ?? null;
  }
  /** 获取统计信息 */
  async getStats(): Promise<QuizStats> {
    const stats = (await this.activityLogService?.stats()) ?? ({ total: 0, today: 0 } as ActivityStats);
    const entries = (await this.activityLogService?.query({ type: 'quiz', limit: 1000 })) ?? [];
    let success = 0;
    let failed = 0;
    for (const e of entries) {
      if (e.data['success'] as boolean) success++;
      else failed++;
    }
    return { total: entries.length, success, failed, today: stats.today };
  }
  /** 导入历史 */
  async importHistory(json: string): Promise<number> {
    const data = JSON.parse(json) as ChallengeResult[];
    let count = 0;
    for (const item of data) {
      await this.recordChallenge(item);
      count++;
    }
    return count;
  }
  /** 导出历史 */
  async exportHistory(): Promise<string> {
    const entries = await this.queryHistory({ limit: 10000 });
    return JSON.stringify(entries, null, 2);
  }
  /** 清空历史 */
  async clearHistory(): Promise<void> {
    await this.activityLogService?.clear('quiz');
  }
}
