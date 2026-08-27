/**
 * 决策做题页面
 * @module presentation/pages/decision/DecisionQuizPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, IBoard, ICard, IDialog, IToast, PageParams } from '../../../../core/interfaces';
import type { IDecisionProblem, IDecisionResult } from '../../../../../domain/decision';
import { renderProblem, renderFeedback } from './DecisionRenderer';
export interface DecisionQuizPageConfig {
  onComplete?: (score: DecisionScore) => void;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export interface DecisionScore {
  correct: number;
  total: number;
  results: IDecisionResult[];
}
export class DecisionQuizPage implements IPage {
  readonly title = '决策做题';
  private onComplete?: ((score: DecisionScore) => void) | undefined;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private board: IBoard;
  private card: ICard;
  private dialog: IDialog;
  private toast: IToast;
  private problems: IDecisionProblem[] = [];
  private currentIndex = 0;
  private score: DecisionScore;
  private answered = false;
  private startTime = 0;
  constructor(config: DecisionQuizPageConfig) {
    this.onComplete = config.onComplete;
    this.onNavigate = config.onNavigate;
    this.board = AdapterFactory.createBoard();
    this.card = AdapterFactory.createCard();
    this.dialog = AdapterFactory.createDialog();
    this.toast = AdapterFactory.createToast();
    this.score = { correct: 0, total: 0, results: [] };
  }
  private handleAiAnalysis: (() => void) | null = null;

  async initialize(): Promise<void> {
    this.board.initialize({ size: 19, showCoordinates: true });
    
    // 监听 AI 分析事件
    this.handleAiAnalysis = () => {
      const problem = this.problems[this.currentIndex];
      if (!problem) {
        this.toast.error('没有当前题目');
        return;
      }
      
      const archiveId = problem.metadata.archiveId;
      const moveTo = problem.metadata.moveNumber;
      
      if (!archiveId) {
        this.toast.error('该题目没有关联棋谱');
        return;
      }
      
      // 跳转到复盘页面的分析局面模式
      const url = `../review/index.html?analyzePosition=true&archiveId=${encodeURIComponent(archiveId)}&moveTo=${moveTo}`;
      window.location.href = url;
    };
    
    window.addEventListener('aiAnalysis', this.handleAiAnalysis);
  }
  handleParams(params: PageParams): void {
    if (params['problemsJson']) {
      try {
        this.problems = JSON.parse(params['problemsJson']);
        this.score = { correct: 0, total: this.problems.length, results: [] };
        this.showProblem(0);
      } catch (e) {
        console.error('解析题目数据失败', e as Error);
        this.toast.error('题目数据格式错误');
      }
    }
  }
  setData(problems: IDecisionProblem[]): void {
    this.problems = problems;
    this.score = { correct: 0, total: problems.length, results: [] };
    this.currentIndex = 0;
    this.showProblem(0);
  }
  private showProblem(index: number): void {
    if (index < 0 || index >= this.problems.length) return;
    const problem = this.problems[index];
    if (!problem) return;
    this.currentIndex = index;
    this.answered = false;
    this.startTime = Date.now();
    renderProblem(this.card, problem, index, this.problems.length);
  }
  async submitAnswer(optionIndex: number): Promise<void> {
    if (this.answered) return;
    this.answered = true;
    const problem = this.problems[this.currentIndex];
    if (!problem) return;
    const isCorrect = optionIndex === problem.correctIndex;
    this.score.results.push({
      problemId: problem.id,
      selectedOption: optionIndex,
      isCorrect,
      timeSpent: Date.now() - this.startTime,
      timestamp: new Date(),
    });
    if (isCorrect) this.score.correct++;
    renderFeedback(this.card, problem, optionIndex, isCorrect);
    if (isCorrect) {
      this.toast.success('回答正确！');
    } else {
      this.toast.error('回答错误');
    }
  }
  nextProblem(): void {
    if (this.currentIndex < this.problems.length - 1) {
      this.showProblem(this.currentIndex + 1);
    } else {
      this.finish();
    }
  }
  previousProblem(): void {
    if (this.currentIndex > 0) {
      this.showProblem(this.currentIndex - 1);
    }
  }
  private finish(): void {
    this.onComplete?.(this.score);
    this.toast.success(`完成！得分：${this.score.correct}/${this.score.total}`);
  }
  getCurrentIndex(): number {
    return this.currentIndex;
  }
  getScore(): DecisionScore {
    return this.score;
  }
  isAnswered(): boolean {
    return this.answered;
  }
  render(): void {
    this.board.render();
    this.card.render();
  }
  destroy(): void {
    if (this.handleAiAnalysis) {
      window.removeEventListener('aiAnalysis', this.handleAiAnalysis);
    }
    this.board.destroy();
    this.card.destroy();
    this.dialog.destroy();
    this.toast.destroy();
  }
}
