/**
 * 定式挑战题库数据管理
 * @description 处理题库加载、选题算法、路径解析
 */
import type { JosekiQuizApp, QuizQuestion } from '../../../../../../application/joseki';
import type { TargetMove } from './QuizExploreMode';
/** 题库数据管理配置 */
export interface QuizDataManagerConfig {
  quizApp: JosekiQuizApp;
}
/**
 * 题库数据管理器
 */
export class QuizDataManager {
  private quizList: QuizQuestion[] = [];
  private currentQuiz: QuizQuestion | null = null;
  constructor(private config: QuizDataManagerConfig) {}
  /** 加载题库 */
  async loadQuizData(
    difficulty: 'easy' | 'medium' | 'hard',
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    await this.config.quizApp.loadQuizData(difficulty, (percent) => {
      onProgress?.(percent);
    });
    this.quizList = await this.config.quizApp.getQuizList(difficulty);
  }
  /** 加载下一题 */
  loadNextQuiz(excludeIds: Set<string>): QuizQuestion | null {
    if (this.quizList.length === 0) return null;
    // 随机选题（避免重复）
    const available = this.quizList.filter((q) => !excludeIds.has(q.id));
    const pool = available.length > 0 ? available : this.quizList;
    // 按出现次数加权选择
    const weightedPool = pool.filter((q) => q.freq && q.freq > 0);
    if (weightedPool.length > 0) {
      const totalWeight = weightedPool.reduce((sum, q) => sum + q.freq, 0);
      let random = Math.random() * totalWeight;
      for (const q of weightedPool) {
        random -= q.freq!;
        if (random <= 0) {
          this.currentQuiz = q;
          return q;
        }
      }
      this.currentQuiz = weightedPool[0]!;
      return this.currentQuiz;
    }
    const randomIndex = Math.floor(Math.random() * pool.length);
    this.currentQuiz = pool[randomIndex]!;
    return this.currentQuiz;
  }
  /** 解析路径为目标着法 */
  parsePath(path: string[]): TargetMove[] {
    return path.map((coord, i) => {
      const isPass = coord === 'tt';
      return {
        x: isPass ? -1 : coord.charCodeAt(0) - 97,
        y: isPass ? -1 : coord.charCodeAt(1) - 97,
        color: i % 2 === 0 ? 'black' as const : 'white' as const,
        isPass,
      };
    });
  }
  /** 获取当前题目 */
  getCurrentQuiz(): QuizQuestion | null {
    return this.currentQuiz;
  }
  /** 获取题库列表 */
  getQuizList(): QuizQuestion[] {
    return this.quizList;
  }
  /** 重置 */
  reset(): void {
    this.quizList = [];
    this.currentQuiz = null;
  }
}
