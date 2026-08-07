/**
 * 定式练习服务接口
 */

import type { QuizQuestion as LoaderQuizQuestion } from '../IJosekiLoader';

/**
 * 练习选项
 */
export interface IQuizOptions {
  /** 难度: easy, medium, hard */
  difficulty?: 'easy' | 'medium' | 'hard' | undefined;
  /** 随机种子 */
  seed?: number | undefined;
}

/**
 * 练习题目（Service 层）
 */
export interface IQuizQuestion {
  id: string;
  path: string[];
  answer: string[];
  moves: number;
  freq: number;
  prob: number;
  winrate?: {
    delta: number;
    stddev?: number;
    samples?: number;
    positive?: number;
    negative?: number;
    neutral?: number;
  };
  options?: string[] | undefined;
  difficulty: number;
  hint?: string | undefined;
}

/**
 * 定式练习服务接口
 */
export interface IJosekiQuizService {
  /** 加载题库数据 */
  loadQuizData(difficulty: 'easy' | 'medium' | 'hard'): Promise<LoaderQuizQuestion[]>;
  /** 生成挑战题目 */
  generateQuiz(options?: IQuizOptions): Promise<IQuizQuestion>;
}
