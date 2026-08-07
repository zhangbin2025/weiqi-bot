/**
 * 答题控制器
 * @description 管理答题状态和逻辑
 * @module presentation/core/controllers/DecisionController
 */
import type { IDecisionProblem, IDecisionResult } from '../../../domain/decision';
/** 答题结果 */
export interface DecisionResult {
  isCorrect: boolean;
  correctIndex: number;
}
/** 答题控制器配置 */
export interface DecisionControllerConfig {
  /** 答题完成回调 */
  onComplete?: (score: DecisionScore) => void;
  /** 题目变化回调 */
  onProblemChange?: (problem: IDecisionProblem, index: number, total: number) => void;
}
/** 答题得分 */
export interface DecisionScore {
  correct: number;
  total: number;
  results: DecisionResultInternal[];
}
interface DecisionResultInternal {
  problemId: string;
  selectedOption: number;
  isCorrect: boolean;
  time: number;
}
/**
 * 答题控制器
 * @description 管理答题状态和逻辑
 */
export class DecisionController {
  private problems: IDecisionProblem[] = [];
  private currentIndex = 0;
  private answered = false;
  private results: DecisionResultInternal[] = [];
  private onComplete: ((score: DecisionScore) => void) | undefined;
  private onProblemChange: ((problem: IDecisionProblem, index: number, total: number) => void) | undefined;
  constructor(config: DecisionControllerConfig = {}) {
    this.onComplete = config.onComplete;
    this.onProblemChange = config.onProblemChange;
  }
  /**
   * 加载题目列表
   */
  loadProblems(problems: IDecisionProblem[]): void {
    this.problems = problems;
    this.currentIndex = 0;
    this.answered = false;
    this.results = [];
    if (problems.length > 0) {
      this.onProblemChange?.(problems[0]!, 0, problems.length);
    }
  }
  /**
   * 获取当前题目
   */
  getCurrentProblem(): IDecisionProblem | null {
    return this.problems[this.currentIndex] ?? null;
  }
  /**
   * 获取当前索引
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }
  /**
   * 获取总题数
   */
  getTotalCount(): number {
    return this.problems.length;
  }
  /**
   * 是否已答题
   */
  isAnswered(): boolean {
    return this.answered;
  }
  /**
   * 提交答案
   */
  submitAnswer(optionIndex: number): DecisionResult {
    if (this.answered) {
      throw new Error('Already answered');
    }
    const problem = this.problems[this.currentIndex];
    if (!problem) {
      throw new Error('No problem loaded');
    }
    const isCorrect = optionIndex === problem.correctIndex;
    this.answered = true;
    this.results.push({
      problemId: problem.id,
      selectedOption: optionIndex,
      isCorrect,
      time: Date.now(),
    });
    return { isCorrect, correctIndex: problem.correctIndex };
  }
  /**
   * 下一题
   * @returns 是否还有下一题
   */
  nextProblem(): boolean {
    if (this.currentIndex >= this.problems.length - 1) {
      // 没有下一题了，完成答题
      const score = this.getScore();
      this.onComplete?.(score);
      return false;
    }
    this.currentIndex++;
    this.answered = false;
    const problem = this.problems[this.currentIndex];
    if (problem) {
      this.onProblemChange?.(problem, this.currentIndex, this.problems.length);
    }
    return true;
  }
  /**
   * 获取得分
   */
  getScore(): DecisionScore {
    const correct = this.results.filter(r => r.isCorrect).length;
    return {
      correct,
      total: this.problems.length,
      results: this.results,
    };
  }
  /**
   * 重置控制器
   */
  reset(): void {
    this.problems = [];
    this.currentIndex = 0;
    this.answered = false;
    this.results = [];
  }
}
