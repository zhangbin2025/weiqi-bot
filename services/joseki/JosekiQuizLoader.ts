/**
 * 定式题库加载器
 * @description 处理定式题库的加载、缓存
 */

import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { IJosekiConfig } from '../../infrastructure/config/schemas/JosekiConfigSchema';
import type { QuizQuestion } from './IJosekiLoader';
import type { GzipLoadProgressCallback } from './GzipJsonLoader';
import { GzipJsonLoader } from './GzipJsonLoader';

/** 题库加载进度回调 */
export type QuizLoadProgressCallback = GzipLoadProgressCallback;

/**
 * 定式题库加载器
 */
export class JosekiQuizLoader {
  private quizCache: Map<string, QuizQuestion[]> = new Map();
  private gzipLoader: GzipJsonLoader;

  constructor(
    gzipLoader: GzipJsonLoader,
    private readonly configProvider: IConfigProvider,
  ) {
    this.gzipLoader = gzipLoader;
  }

  /**
   * 获取数据路径
   */
  private async getDataUrl(): Promise<string> {
    const config = await this.configProvider.getModuleConfig<IJosekiConfig>('joseki');
    return config.dataUrl;
  }

  /**
   * 加载题库
   * @param difficulty - 难度
   */
  async loadQuizData(
    difficulty: 'easy' | 'medium' | 'hard',
    onProgress?: QuizLoadProgressCallback,
  ): Promise<QuizQuestion[]> {
    // 检查内存缓存
    if (this.quizCache.has(difficulty)) {
      return this.quizCache.get(difficulty)!;
    }

    const dataUrl = await this.getDataUrl();

    onProgress?.(0, `加载${getDifficultyName(difficulty)}题库`);
    const data = await this.gzipLoader.load<{ leaves: QuizQuestion[]; count: number }>(
      `${dataUrl}/quiz-${difficulty}.json.gz`,
      `joseki/quiz-${difficulty}.json.gz`,
      onProgress,
    );
    onProgress?.(100, '题库加载完成');

    const questions = data.leaves ?? [];
    this.quizCache.set(difficulty, questions);

    return questions;
  }

  /**
   * 清除题库缓存
   */
  clearCache(): void {
    this.quizCache.clear();
  }
}

function getDifficultyName(d: 'easy' | 'medium' | 'hard'): string {
  return { easy: '初级', medium: '中级', hard: '高级' }[d];
}
