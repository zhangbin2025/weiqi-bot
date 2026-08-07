/**
 * 定式挑战应用编排器
 * @description 组合 JosekiQuizService、ActivityLogService、ThumbnailService 完成定式挑战
 */
import type { IJosekiQuizService, IQuizOptions, IQuizQuestion } from '../../services/joseki/quiz/IJosekiQuizService';
import type { QuizQuestion as LoaderQuizQuestion } from '../../services/joseki/IJosekiLoader';
import type { IActivityLogService } from '../../services/activity';
import type { IFavoriteService } from '../../services/favorite';
import type { ThumbnailMove } from '../../services/thumbnail/types';
import { ThumbnailService } from '../../services/thumbnail/ThumbnailService';
import { QuizHistoryManager, QuizHistoryEntry, QuizHistoryOptions, QuizStats, ChallengeResult } from './quiz/QuizHistoryManager';
/** 练习选项（App 层） */
export interface QuizOptions {
  difficulty?: 'easy' | 'medium' | 'hard' | undefined;
  seed?: number | undefined;
}
/** 练习题目（App 层） */
export interface QuizQuestion {
  id: string;
  path: string[];
  moves: number;
  freq: number;
  prob: number;
  winrate?: {
    delta: number;
    stddev?: number;
    samples?: number;
  };
  answer?: string[];
  options?: string[] | undefined;
  difficulty?: number;
  hint?: string | undefined;
}
/** 题库加载进度回调 */
export type QuizLoadProgressCallback = (percent: number, status: string) => void;
// 导出历史相关类型（保持向后兼容）
export type { QuizHistoryEntry, QuizHistoryOptions, QuizStats, ChallengeResult };
/**
 * 定式挑战应用编排器
 */
export class JosekiQuizApp {
  private cachedQuestions: LoaderQuizQuestion[] = [];
  private cachedDifficulty?: 'easy' | 'medium' | 'hard';
  private historyManager: QuizHistoryManager;
  private favoriteService?: IFavoriteService;
  constructor(
    private readonly josekiQuizService?: IJosekiQuizService,
    activityLogService?: IActivityLogService,
    private readonly thumbnailService?: ThumbnailService,
    favoriteService?: IFavoriteService,
  ) {
    this.historyManager = new QuizHistoryManager(activityLogService);
    if (favoriteService) {
      this.favoriteService = favoriteService;
    }
  }
  /** 加载题库 */
  async loadQuizData(
    difficulty: string,
    onProgress?: QuizLoadProgressCallback,
  ): Promise<number> {
    if (!this.josekiQuizService) throw new Error('JosekiQuizService not available');
    const validDifficulty = ['easy', 'medium', 'hard'].includes(difficulty)
      ? difficulty as 'easy' | 'medium' | 'hard'
      : 'easy';
    onProgress?.(0, '开始加载题库...');
    this.cachedQuestions = await this.josekiQuizService.loadQuizData(validDifficulty);
    onProgress?.(100, '加载完成');
    return this.cachedQuestions.length;
  }
  /** 获取题库列表 */
  async getQuizList(difficulty: string): Promise<QuizQuestion[]> {
    const validDifficulty = ['easy', 'medium', 'hard'].includes(difficulty)
      ? difficulty as 'easy' | 'medium' | 'hard'
      : 'easy';
    if (!this.cachedQuestions || this.cachedDifficulty !== validDifficulty) {
      await this.loadQuizData(validDifficulty);
    }
    // 转换 LoaderQuizQuestion -> QuizQuestion
    return this.cachedQuestions.map((q, idx) => ({
      id: `quiz-${validDifficulty}-${idx}`,
      path: q.path.split('-'),
      moves: q.moves,
      freq: q.freq,
      prob: q.prob,
      ...(q.winrate && { winrate: q.winrate }),
    }));
  }
  /** 生成挑战题目 */
  async generateQuiz(options?: QuizOptions): Promise<QuizQuestion> {
    if (!this.josekiQuizService) throw new Error('JosekiQuizService not available');
    const serviceOptions: IQuizOptions = {
      difficulty: options?.difficulty,
      seed: options?.seed,
    };
    const question = await this.josekiQuizService.generateQuiz(serviceOptions);
    return {
      id: question.id,
      path: question.path,
      moves: question.moves,
      freq: question.freq,
      prob: question.prob,
      ...(question.winrate && { winrate: question.winrate }),
      answer: question.answer,
      options: question.options,
      difficulty: question.difficulty,
      hint: question.hint,
    };
  }
  /** 构建棋盘状态 */
  buildBoardState(moves: ThumbnailMove[]) {
    return (this.thumbnailService ?? new ThumbnailService()).buildBoardState(moves);
  }
  // ========== 历史管理（委托给 QuizHistoryManager） ==========
  /** 记录挑战结果 */
  async recordChallenge(result: ChallengeResult): Promise<string | undefined> {
    return this.historyManager.recordChallenge(result);
  }
  /** 查询挑战历史 */
  async queryHistory(options?: QuizHistoryOptions): Promise<QuizHistoryEntry[]> {
    return this.historyManager.queryHistory(options);
  }
  /** 获取单条历史详情 */
  async getHistoryDetail(id: string) {
    return this.historyManager.getHistoryDetail(id);
  }
  /** 获取统计信息 */
  async getStats(): Promise<QuizStats> {
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
  // ========== 难度偏好（使用收藏服务） ==========
  /** 保存难度偏好到收藏服务 */
  async saveDifficultyPreference(difficulty: string): Promise<void> {
    if (!this.favoriteService) return;
    await this.favoriteService.addFavorite('quiz-preference', 'difficulty', { value: difficulty });
  }
  /** 从收藏服务加载难度偏好 */
  async loadDifficultyPreference(): Promise<string | null> {
    if (!this.favoriteService) return null;
    const item = await this.favoriteService.getFavorite('quiz-preference', 'difficulty');
    if (item?.data && typeof item.data === 'object' && 'value' in item.data) {
      const value = (item.data as { value: string }).value;
      if (['easy', 'medium', 'hard'].includes(value)) {
        return value;
      }
    }
    return null;
  }
}
