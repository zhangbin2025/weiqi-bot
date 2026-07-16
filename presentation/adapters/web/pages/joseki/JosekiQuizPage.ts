/**
 * 定式挑战页面
 * @module presentation/adapters/web/pages/joseki/JosekiQuizPage
 */
import { JosekiBoard } from '../../components/JosekiBoard';
import type { IPage, PageParams } from '../../../../core/interfaces';
import type { IAudioPlayer } from '../../../../../infrastructure/audio/IAudioPlayer';
import type { JosekiQuizApp, QuizQuestion } from '../../../../../application/joseki';
import { QuizUIHelper } from './quiz/QuizUIHelper';
import { QuizExploreMode, TargetMove } from './quiz/QuizExploreMode';
import { QuizChallengeMode } from './quiz/QuizChallengeMode';
import { QuizHistoryPanel } from './quiz/QuizHistoryPanel';
import { QuizDataManager } from './quiz/QuizDataManager';
import { Dialog, Select } from '@ui';
/** 标签页 */
type QuizTab = 'challenge' | 'history';
/** 难度 */
type Difficulty = 'easy' | 'medium' | 'hard';
/** 模式 */
type QuizMode = 'explore' | 'challenge';
/** 页面配置 */
export interface JosekiQuizPageConfig {
  quizApp: JosekiQuizApp;
  audioPlayer?: IAudioPlayer;
}
/** 定式挑战页面 */
export class JosekiQuizPage implements IPage {
  readonly title = '定式挑战';
  private quizApp: JosekiQuizApp;
  // UI 组件
  private board: JosekiBoard;
  // 子模块
  private uiHelper: QuizUIHelper;
  private exploreMode: QuizExploreMode;
  private challengeMode: QuizChallengeMode;
  private historyPanel: QuizHistoryPanel;
  private dataManager: QuizDataManager;
  // 状态
  private currentTab: QuizTab = 'challenge';
  private currentDifficulty: Difficulty = 'easy';
  private mode: QuizMode = 'explore';
  private targetMoves: TargetMove[] = [];
  private userMoves: TargetMove[] = [];
  private currentIndex: number = 0;
  private initialized = false;
  constructor(config: JosekiQuizPageConfig) {
    this.quizApp = config.quizApp;
    this.board = new JosekiBoard(undefined, config.audioPlayer);
    this.uiHelper = new QuizUIHelper();
    this.dataManager = new QuizDataManager({ quizApp: this.quizApp });
    this.historyPanel = new QuizHistoryPanel({ quizApp: this.quizApp });
    this.exploreMode = new QuizExploreMode({ board: this.board, uiHelper: this.uiHelper });
    this.challengeMode = new QuizChallengeMode({
      board: this.board,
      uiHelper: this.uiHelper,
      audioPlayer: config.audioPlayer,
      onChallengeComplete: (result) => this.handleChallengeComplete(result),
    });
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    // 预加载缩略图图片（等待完成）
    const { preloadThumbnailImages } = await import('../../components/JosekiThumbnail');
    await preloadThumbnailImages();
    // 初始化棋盘
    const container = document.getElementById('board-container');
    if (container) container.appendChild(this.board.canvas);
    this.board.initialize();
    // 绑定棋盘点击
    this.board.on({ onClick: (pos) => this.handleBoardClick(pos) });
    // 绑定按钮事件
    this.bindEvents();
    // 加载历史
    await this.historyPanel.loadHistory();
    // 先恢复难度偏好，再加载题库
    await this.loadSavedDifficulty();
    // 加载题库
    await this.loadQuizData();
    this.initialized = true;
  }
  private bindEvents(): void {
    // 标签切换
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabId = (tab as HTMLElement).dataset['tab'];
        if (tabId) this.switchTab(tabId as QuizTab);
      });
    });
    // 难度选择
    Select.get('#difficulty-select')?.onChange((v) => {
      this.currentDifficulty = v as Difficulty;
      this.quizApp.saveDifficultyPreference(this.currentDifficulty).catch((err) => {
        console.warn('保存难度偏好失败', err as Error);
      });
      this.loadQuizData();
    });
    // 功能按钮
    document.getElementById('undo-btn')?.addEventListener('click', () => this.undo());
    document.getElementById('pass-btn')?.addEventListener('click', () => this.handlePass());
    document.getElementById('challenge-btn')?.addEventListener('click', () => this.challengeMode.showColorModal());
    document.getElementById('next-btn')?.addEventListener('click', () => this.loadNextQuiz());
    // 选择颜色弹框
    document.getElementById('select-black')?.addEventListener('click', () => this.startChallenge('black'));
    document.getElementById('select-white')?.addEventListener('click', () => this.startChallenge('white'));
    document.getElementById('cancel-challenge')?.addEventListener('click', () => this.challengeMode.hideColorModal());
    // 挑战失败弹框
    document.getElementById('back-explore')?.addEventListener('click', () => this.backToExplore());
    document.getElementById('retry-challenge')?.addEventListener('click', () => this.retryChallenge());
    // 挑战成功弹框
    document.getElementById('next-quiz')?.addEventListener('click', () => {
      this.uiHelper.hideModal('success-modal');
      this.loadNextQuiz();
    });
    // 历史面板
    document.getElementById('clear-btn')?.addEventListener('click', () => this.historyPanel.clearHistory());
    document.getElementById('prev-page-btn')?.addEventListener('click', () => this.historyPanel.prevPage(() => this.renderHistoryPanel()));
    document.getElementById('next-page-btn')?.addEventListener('click', () => this.historyPanel.nextPage(() => this.renderHistoryPanel()));
    // 胜率详情弹窗
    document.getElementById('stat-winrate')?.addEventListener('click', () => this.uiHelper.showWinrateDetail(this.dataManager.getCurrentQuiz()?.winrate));
    document.getElementById('winrate-close-btn')?.addEventListener('click', () => this.uiHelper.hideWinrateDetail());
    document.getElementById('winrate-backdrop')?.addEventListener('click', () => this.uiHelper.hideWinrateDetail());
  }
  handleParams(params: PageParams): void {
    if (params['difficulty']) {
      this.currentDifficulty = params['difficulty'] as Difficulty;
      Select.get('#difficulty-select')?.setValue(this.currentDifficulty, true);
      // 重新加载对应难度的题库
      this.loadQuizData();
    }
  }
  // ========== 题库加载 ==========
  private async loadQuizData(): Promise<void> {
    try {
      const progressBar = document.getElementById('progress-bar');
      if (progressBar) progressBar.style.width = '0%';
      await this.dataManager.loadQuizData(this.currentDifficulty, (percent) => {
        if (progressBar) progressBar.style.width = `${percent}%`;
      });
      if (progressBar) progressBar.style.width = '100%';
      await this.loadNextQuiz();
    } catch (error) {
      console.error('加载题库失败', error as Error);
      await Dialog.alert('加载题库失败');
    }
  }
  /** 加载保存的难度偏好 */
  private async loadSavedDifficulty(): Promise<void> {
    try {
      const saved = await this.quizApp.loadDifficultyPreference();
      if (saved && ['easy', 'medium', 'hard'].includes(saved)) {
        this.currentDifficulty = saved as 'easy' | 'medium' | 'hard';
        Select.get('#difficulty-select')?.setValue(this.currentDifficulty, true);
        console.info(`恢复难度偏好: ${saved}`);
      }
    } catch (error) {
      console.warn('读取难度偏好失败', error as Error);
    }
  }
  private async loadNextQuiz(): Promise<void> {
    const excludeIds = new Set(this.historyPanel.getHistory().map((h) => h.id));
    const quiz = this.dataManager.loadNextQuiz(excludeIds);
    if (!quiz) {
      await Dialog.alert('暂无题目');
      return;
    }
    // 解析目标着法
    this.targetMoves = this.dataManager.parsePath(quiz.path);
    // 重置状态
    this.mode = 'explore';
    this.userMoves = [];
    this.currentIndex = 0;
    this.uiHelper.updateModeBadge('explore');
    this.updateStats();
    this.updateProgress();
    this.showExploreState();
  }
  // ========== 探索模式 ==========
  private showExploreState(): void {
    const state = { currentIndex: this.currentIndex, userMoves: this.userMoves };
    const result = this.exploreMode.showExploreState(this.targetMoves, state);
    if (result && result.needAutoSkip) {
      // 自动跳过脱先
      this.currentIndex = result.newIndex;
      this.userMoves = result.newUserMoves;
      this.updateProgress();
      this.board.setMoves(this.userMoves);
      setTimeout(() => this.showExploreState(), 800);
    }
  }
  // ========== 挑战模式 ==========
  private startChallenge(color: 'black' | 'white'): void {
    this.mode = 'challenge';
    this.userMoves = [];
    this.currentIndex = 0;
    this.challengeMode.startChallenge(color, this.targetMoves, () => this.updateProgress());
  }
  private backToExplore(): void {
    this.mode = 'explore';
    this.currentIndex = 0;
    this.userMoves = [];
    this.challengeMode.backToExplore(this.targetMoves, () => this.updateProgress());
    this.showExploreState();
  }
  private retryChallenge(): void {
    this.userMoves = [];
    this.currentIndex = 0;
    this.challengeMode.retryChallenge(this.targetMoves, () => this.updateProgress());
  }
  private async handleChallengeComplete(result: { success: boolean; path: string[] }): Promise<void> {
    await this.quizApp.recordChallenge({
      path: result.path,
      difficulty: this.currentDifficulty,
      success: result.success,
      attempts: 1,
    });
    await this.historyPanel.loadHistory();
  }
  // ========== 点击处理 ==========
  private handleBoardClick(pos: { x: number; y: number }): void {
    if (this.mode === 'explore') {
      const result = this.exploreMode.handleClick(pos, this.targetMoves, this.currentIndex);
      if (result.correct) {
        const move = this.targetMoves[this.currentIndex];
        if (move) {
          this.userMoves.push(move);
        }
        this.currentIndex = result.newIndex;
        this.updateProgress();
        this.showExploreState();
      }
    } else {
      const result = this.challengeMode.handleClick(pos, this.targetMoves, () => this.updateProgress());
      if (result.correct) {
        this.currentIndex = result.newIndex;
        this.challengeMode.showChallengeState(this.targetMoves, () => this.updateProgress());
      }
    }
  }
  private handlePass(): void {
    if (this.mode !== 'challenge') return;
    const success = this.challengeMode.handlePass(this.targetMoves, () => this.updateProgress());
    if (success) {
      this.currentIndex++;
      setTimeout(() => this.challengeMode.showChallengeState(this.targetMoves, () => this.updateProgress()), 600);
    }
  }
  private undo(): void {
    if (this.mode !== 'explore' || this.currentIndex <= 0) return;
    this.currentIndex--;
    this.userMoves.pop();
    // 跳过脱先手
    while (this.currentIndex > 0 && this.targetMoves[this.currentIndex]?.isPass) {
      this.currentIndex--;
    }
    this.updateProgress();
    this.showExploreState();
  }
  // ========== 标签切换 ==========
  private switchTab(tab: QuizTab): void {
    this.currentTab = tab;
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', (t as HTMLElement).dataset['tab'] === tab);
    });
    (document.getElementById('challenge-tab') as HTMLElement).style.display = tab === 'challenge' ? 'block' : 'none';
    (document.getElementById('history-tab') as HTMLElement).style.display = tab === 'history' ? 'block' : 'none';
    if (tab === 'history') this.renderHistoryPanel();
  }
  private renderHistoryPanel(): void {
    this.historyPanel.renderHistoryPanel((entry) => {
      const quiz: QuizQuestion = { id: entry.id, path: entry.path, moves: entry.path.length, freq: entry.freq || 0, prob: entry.prob || 0 };
      this.targetMoves = this.dataManager.parsePath(entry.path);
      this.currentIndex = 0;
      this.userMoves = [];
      this.mode = 'explore';
      this.uiHelper.updateModeBadge('explore');
      this.switchTab('challenge');
      (document.getElementById('pass-btn') as HTMLElement).style.display = 'none';
      this.updateStats(quiz);
      this.updateProgress();
      this.showExploreState();
    });
  }
  // ========== UI更新 ==========
  private updateProgress(): void {
    this.uiHelper.updateProgress(this.currentIndex, this.targetMoves.length);
  }
  private updateStats(quiz?: QuizQuestion): void {
    const current = quiz ?? this.dataManager.getCurrentQuiz();
    if (!current) return;
    (document.getElementById('stat-moves') as HTMLElement).textContent = String(current.moves);
    (document.getElementById('stat-freq') as HTMLElement).textContent = this.uiHelper.formatFreq(current.freq);
    (document.getElementById('stat-prob') as HTMLElement).textContent = this.uiHelper.formatProb(current.prob);
    const winrateEl = document.getElementById('stat-winrate') as HTMLElement;
    if (current.winrate) {
      const delta = current.winrate.delta;
      winrateEl.textContent = (delta > 0 ? '+' : '') + (delta * 100).toFixed(1) + '%';
      winrateEl.className = 'stat-value clickable ' + (delta > 0.02 ? 'positive' : delta < -0.02 ? 'negative' : 'neutral');
    } else {
      winrateEl.textContent = '-';
      winrateEl.className = 'stat-value';
    }
  }
  render(): void {
    this.board.render();
    if (this.currentTab === 'history') this.renderHistoryPanel();
  }
  /** 清除历史（向后兼容） */
  async clearHistory(): Promise<void> {
    await this.historyPanel.clearHistory();
  }
  destroy(): void {
    this.board.destroy();
    this.historyPanel.reset();
    this.dataManager.reset();
    this.initialized = false;
  }
}
