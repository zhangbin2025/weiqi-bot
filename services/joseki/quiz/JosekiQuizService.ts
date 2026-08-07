/**
 * 定式练习服务实现
 * @description 改用预置题库数据，保留业务逻辑（选题、生成选项、生成提示）
 */

import type { IJosekiQuizService, IQuizQuestion, IQuizOptions } from './IJosekiQuizService';
import type { QuizQuestion as LoaderQuizQuestion } from '../IJosekiLoader';
import type { JosekiLoader } from '../JosekiLoader';
import type { IJosekiQuizConfig } from '../../../infrastructure/config/schemas/JosekiQuizConfigSchema';

export type ConfigProvider = () => Promise<IJosekiQuizConfig>;

/** 难度映射（字符串 → 数字） */
const DIFFICULTY_MAP: Record<'easy' | 'medium' | 'hard', number> = {
  easy: 2,
  medium: 4,
  hard: 6
};

/**
 * 定式练习服务
 */
export class JosekiQuizService implements IJosekiQuizService {
  private quizCache: Map<string, LoaderQuizQuestion[]> = new Map();

  constructor(
    private readonly loader: JosekiLoader,
    private readonly configProvider?: ConfigProvider
  ) {}

  /**
   * 加载题库数据
   */
  async loadQuizData(difficulty: 'easy' | 'medium' | 'hard'): Promise<LoaderQuizQuestion[]> {
    // 检查缓存
    const cached = this.quizCache.get(difficulty);
    if (cached) return cached;

    // 从 loader 加载
    const questions = await this.loader.loadQuizData(difficulty);

    // 缓存
    this.quizCache.set(difficulty, questions);

    return questions;
  }

  /**
   * 生成挑战题目（从题库数据中选择）
   */
  async generateQuiz(options?: IQuizOptions): Promise<IQuizQuestion> {
    const config = this.configProvider ? await this.configProvider() : undefined;

    // 确定 difficulty
    const difficultyStr = options?.difficulty ?? 
      (config?.defaultDifficulty ?? 'easy') as 'easy' | 'medium' | 'hard';
    const difficulty = DIFFICULTY_MAP[difficultyStr];

    // 加载题库
    const quizData = await this.loadQuizData(difficultyStr);

    if (quizData.length === 0) {
      throw new Error('No quiz data available');
    }

    // 选择题目（随机或按种子）
    const seed = options?.seed ?? Math.random();
    const index = Math.floor(seed * quizData.length) % quizData.length;
    const selected = quizData[index]!;

    // 解析 path（如 "pd-qc-pc-qd" → ['pd', 'qc', 'pc', 'qd']）
    const path = selected.path.split('-');

    // 生成答案（最后一手）
    const answer = path.length > 0 ? [path[path.length - 1]!] : [];

    // 生成题目 ID
    const id = `quiz-${difficultyStr}-${index}-${Date.now()}`;

    const question: IQuizQuestion = {
      id,
      path,
      answer,
      moves: path.length,
      freq: selected.freq ?? 0,
      prob: selected.prob ?? 0,
      difficulty,
      ...(selected.winrate && { winrate: selected.winrate }),
    };

    // 低难度：生成选项（从同难度题库中取其他题目作为干扰项）
    if (difficulty < 4) {
      question.options = this.generateOptions(quizData, selected, index);
    }

    // 生成提示
    if (selected.winrate) {
      question.hint = this.generateHint(selected);
    }

    return question;
  }

  /**
   * 生成选项（从题库其他题目中取干扰项）
   */
  private generateOptions(
    quizData: LoaderQuizQuestion[],
    selected: LoaderQuizQuestion,
    selectedIndex: number
  ): string[] {
    const answer = selected.path.split('-').pop() || '';

    // 从其他题目中取干扰项（最后一手）
    const distractors: string[] = [];
    for (let i = 0; i < Math.min(3, quizData.length - 1); i++) {
      const idx = (selectedIndex + i + 1) % quizData.length;
      const q = quizData[idx];
      if (q && q.path) {
        const lastMove = q.path.split('-').pop();
        if (lastMove && lastMove !== answer && !distractors.includes(lastMove)) {
          distractors.push(lastMove);
        }
      }
    }

    // 合并答案和干扰项，排序
    return [answer, ...distractors].sort();
  }

  /**
   * 生成提示（基于胜率统计）
   */
  private generateHint(question: LoaderQuizQuestion): string {
    if (!question.winrate) return '';

    const delta = question.winrate.delta;
    const sign = delta > 0 ? '+' : '';
    const samples = question.winrate.samples ?? 0;

    if (samples > 100) {
      return `胜率变化: ${sign}${(delta * 100).toFixed(1)}% (${samples}样本)`;
    }
    return `胜率变化: ${sign}${(delta * 100).toFixed(1)}%`;
  }
}