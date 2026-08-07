/**
 * 实战选点页面
 * @module presentation/adapters/web/pages/decision/DecisionPage
 */
import { WebBoard } from '../../components/Board';
import { BoardNavigator } from '../../components/BoardNavigator';
import { DecisionPanel } from './DecisionPanel';
import { VariationViewer } from './VariationViewer';
import { DecisionController } from '../../../../core/controllers/DecisionController';
import { MoveNavigator } from '../../../../core/controllers/MoveNavigator';
import { TrialController, type TrialMove } from '../../../../core/controllers/TrialController';
import { ReplayHelper } from '../../../../core/helpers/ReplayHelper';
import { BoardRebuilder, type MoveNumber } from '../../../../core/helpers/BoardRebuilder';
import { BoardSyncer } from '../../../../core/helpers/BoardSyncer';
import { Game } from '../../../../../domain/game';
import { coordToPos } from '../../../../../domain/sgf';
import type { IPage, PageParams } from '../../../../core/interfaces';
import type { IDecisionProblem, IDecisionOption } from '../../../../../domain/decision';
import type { IAudioPlayer, SoundType } from '../../../../../infrastructure/audio/IAudioPlayer';
import { Dialog } from '@ui';
export interface DecisionPageConfig {
  audioPlayer: IAudioPlayer;
  onComplete?: (score: { correct: number; total: number }) => void;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class DecisionPage implements IPage {
  readonly title = '实战选点';
  private audioPlayer: IAudioPlayer;
  private onComplete: ((score: { correct: number; total: number }) => void) | undefined;
  private onNavigate: ((page: string, params?: Record<string, string>) => void) | undefined;
  // 组件
  private board: WebBoard;
  private boardNavigator: BoardNavigator | null = null;
  private decisionPanel: DecisionPanel | null = null;
  private variationViewer: VariationViewer | null = null;
  private game: Game;
  private moveNavigator: MoveNavigator;
  private decisionController: DecisionController;
  private trialController: TrialController;
  // 状态
  private problems: IDecisionProblem[] = [];
  private currentProblem: IDecisionProblem | null = null;
  private moveNumbersList: MoveNumber[] = [];
  private initialized = false;
  private inTrial = false;
  constructor(config: DecisionPageConfig) {
    this.audioPlayer = config.audioPlayer;
    this.onComplete = config.onComplete;
    this.onNavigate = config.onNavigate;
    this.board = new WebBoard();
    this.game = new Game();
    this.moveNavigator = new MoveNavigator({
      maxMoves: 0,
      onMoveChange: (i) => {
        // 导航回调（查看变化图时使用）
      },
    });
    this.decisionController = new DecisionController({
      onComplete: (score) => {
        this.onComplete?.(score);
        this.showCompleteDialog(score);
      },
      onProblemChange: (problem, index, total) => {
        this.loadProblem(problem, index, total);
      },
    });
    this.trialController = new TrialController({
      onEnter: () => {
        this.inTrial = true;
        this.updateTrialUI();
      },
      onExit: () => {
        this.inTrial = false;
        this.updateTrialUI();
        this.restoreProblemState();
      },
    });
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.board.initialize({ size: 19, showCoordinates: true });
    this.bindEvents();
    this.initialized = true;
  }
  handleParams(params: PageParams): void {
    if (params['problemsJson']) {
      try {
        this.problems = JSON.parse(params['problemsJson']);
        this.decisionController.loadProblems(this.problems);
      } catch (e) {
        console.error('解析题目数据失败', e as Error);
      }
    }
  }
  setData(problems: IDecisionProblem[]): void {
    this.problems = problems;
    this.decisionController.loadProblems(problems);
  }
  /**
   * 加载题目
   */
  private loadProblem(problem: IDecisionProblem, index: number, total: number): void {
    this.currentProblem = problem;
    // 1. 从题目位置生成SGF并解析
    const sgf = this.buildSGFFromPosition(problem.position);
    const replayData = ReplayHelper.generateReplayData(sgf, {}, problem.metadata.moveNumber);
    // 2. 重建棋盘到题目局面
    this.moveNumbersList = BoardRebuilder.rebuild(
      this.game,
      replayData,
      [],
      problem.metadata.moveNumber
    );
    // 3. 同步显示
    BoardSyncer.sync(this.board, this.game, this.moveNumbersList, false);
    // 4. 绘制ABCD选项标记
    this.renderDecisionOptions(problem.options);
    // 5. 更新UI
    this.updateProblemInfo(problem, index, total);
  }
  /**
   * 从位置序列构建SGF
   */
  private buildSGFFromPosition(position: string | Array<{ color: 'B' | 'W'; coord: string }>): string {
    const normalized = Array.isArray(position) ? position : this.parsePositionString(position);
    const moves = normalized.map(m => `;${m.color}[${m.coord}]`).join('');
    return `(;SZ[19]${moves})`;
  }
  private parsePositionString(position: string): Array<{ color: 'B' | 'W'; coord: string }> {
    const moves: Array<{ color: 'B' | 'W'; coord: string }> = [];
    const re = /([BW])([a-z]{2})/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(position))) {
      moves.push({ color: match[1] as 'B' | 'W', coord: match[2]! });
    }
    return moves;
  }
  /**
   * 绘制ABCD选项标记
   */
  private renderDecisionOptions(options: IDecisionOption[]): void {
    options.forEach(opt => {
      const pos = coordToPos(opt.position);
      if (pos) {
        // 使用WebBoard的setMarker方法绘制字母标记
        this.board.setMarker({ x: pos.x, y: pos.y }, opt.label);
      }
    });
  }
  /**
   * 选择答案
   */
  private selectAnswer(optionIndex: number): void {
    if (!this.currentProblem || this.decisionController.isAnswered()) return;
    const result = this.decisionController.submitAnswer(optionIndex);
    // 播放音效
    this.audioPlayer.play(result.isCorrect ? 'correct' : 'wrong');
    // 显示反馈
    this.showAnswerFeedback(optionIndex, result.isCorrect);
    // 更新DecisionPanel
    this.decisionPanel?.showAnswerResult(optionIndex, result.isCorrect);
    // 如果正确，显示变化图（可选）
    if (result.isCorrect) {
      const correctOption = this.currentProblem.options[result.correctIndex];
      if (correctOption && correctOption.variation) {
        this.showVariation(correctOption.variation);
      }
    }
  }
  /**
   * 显示答题反馈
   */
  private showAnswerFeedback(selectedIndex: number, isCorrect: boolean): void {
    // 高亮正确/错误选项
    if (this.currentProblem) {
      const correctOption = this.currentProblem.options[this.currentProblem.correctIndex];
      const selectedOption = this.currentProblem.options[selectedIndex];
      // 在棋盘上标记
      if (correctOption) {
        const pos = coordToPos(correctOption.position);
        if (pos) {
          this.board.highlight({ x: pos.x, y: pos.y }, isCorrect ? 'correct' : 'answer');
        }
      }
      if (!isCorrect && selectedOption && correctOption) {
        const pos = coordToPos(selectedOption.position);
        if (pos) {
          this.board.highlight({ x: pos.x, y: pos.y }, 'wrong');
        }
      }
      this.board.render();
    }
  }
  /**
   * 显示变化图
   */
  private showVariation(variation: Array<{ color: 'B' | 'W'; coord: string }>): void {
    const container = document.getElementById('variation-root');
    if (!container) return;
    // 创建变化图浏览器
    this.variationViewer = new VariationViewer({
      board: this.board,
      game: this.game,
      container,
      onClose: () => {
        this.variationViewer = null;
        // 恢复题目局面
        if (this.currentProblem) {
          this.loadProblem(
            this.currentProblem,
            this.decisionController.getCurrentIndex(),
            this.decisionController.getTotalCount()
          );
        }
      },
    });
    // 显示变化图
    this.variationViewer.show(variation, this.moveNumbersList);
  }
  /**
   * 下一题
   */
  private nextProblem(): void {
    const hasMore = this.decisionController.nextProblem();
    if (!hasMore) {
      console.info('答题完成');
    }
  }
  /**
   * 更新题目信息
   */
  private updateProblemInfo(problem: IDecisionProblem, index: number, total: number): void {
    const titleEl = document.getElementById('gameTitle');
    const infoEl = document.getElementById('gameInfo');
    const progressEl = document.getElementById('progressText');
    if (titleEl) {
      titleEl.textContent = `实战选点 ${index + 1}/${total}`;
    }
    if (infoEl) {
      const difficulty = problem.difficulty || '中等';
      const phase = problem.phase || '中盘';
      infoEl.textContent = `[${phase}] [${difficulty}]`;
    }
    if (progressEl) {
      progressEl.textContent = `${index + 1} / ${total}`;
    }
  }
  /**
   * 显示完成对话框
   */
  private showCompleteDialog(score: { correct: number; total: number }): void {
    const percentage = Math.round((score.correct / score.total) * 100);
    void Dialog.alert(`正确：${score.correct}/${score.total}\n正确率：${percentage}%`, { title: '答题完成' });
  }
  /**
   * 进入试下模式
   */
  private enterTrialMode(): void {
    if (!this.currentProblem || this.decisionController.isAnswered()) return;
    this.trialController.enterTrial([], this.moveNumbersList.length);
    this.audioPlayer.play('stone');
  }
  /**
   * 退出试下模式
   */
  private exitTrialMode(): void {
    this.trialController.exitTrial();
    this.restoreProblemState();
  }
  /**
   * 更新试下模式UI
   */
  private updateTrialUI(): void {
    const trialPanel = document.getElementById('trial-panel');
    const decisionPanel = document.getElementById('decision-root');
    if (this.inTrial) {
      trialPanel?.classList.add('active');
      decisionPanel?.classList.add('hidden');
    } else {
      trialPanel?.classList.remove('active');
      decisionPanel?.classList.remove('hidden');
    }
  }
  /**
   * 恢复题目状态
   */
  private restoreProblemState(): void {
    if (!this.currentProblem) return;
    // 重新加载题目局面
    this.loadProblem(
      this.currentProblem,
      this.decisionController.getCurrentIndex(),
      this.decisionController.getTotalCount()
    );
  }
  /**
   * 处理试下棋盘点击
   */
  private handleTrialBoardClick(x: number, y: number): void {
    const state = this.game.getState();
    const result = this.game.placeStone(x, y);
    if (result.success) {
      this.trialController.addMove({
        x,
        y,
        color: state.currentPlayer,
        capturedCount: result.captured.length,
        capturedPositions: result.captured.map(c => ({ x: c.x, y: c.y })),
      });
      this.audioPlayer.play('stone');
      // 同步棋盘显示
      const trialMoves = this.trialController.getTrialMoves();
      const moveNumbers = this.moveNumbersList.concat(
        trialMoves.map((m: TrialMove, i: number) => ({
          x: m.x,
          y: m.y,
          number: this.moveNumbersList.length + i + 1,
        }))
      );
      BoardSyncer.sync(this.board, this.game, moveNumbers, true);
    }
  }
  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // 棋盘点击事件
    this.board.on({
      onClick: (pos) => {
        // 如果在试下模式，处理试下点击
        if (this.inTrial) {
          this.handleTrialBoardClick(pos.x, pos.y);
          return;
        }
        // 否则，检查是否点击了选项
        if (!this.currentProblem || this.decisionController.isAnswered()) return;
        // 查找点击位置对应的选项
        const optionIndex = this.currentProblem.options.findIndex(opt => {
          const optPos = coordToPos(opt.position);
          return optPos && optPos.x === pos.x && optPos.y === pos.y;
        });
        if (optionIndex >= 0) {
          this.selectAnswer(optionIndex);
        }
      },
    });
  }
  render(): void {
    const container = document.getElementById('page-root');
    if (!container) return;
    container.innerHTML = `
      <div class="container">
        <div class="header">
          <h1 id="gameTitle">实战选点</h1>
          <div class="info" id="gameInfo">请加载题目</div>
        </div>
        <div id="board-root"></div>
        <div id="navigator-root"></div>
        <div id="decision-root"></div>
        <div id="variation-root"></div>
        <div id="trial-panel" class="trial-panel">
          <div class="trial-controls">
            <button class="btn" id="trialPrevBtn" title="上一步">◀</button>
            <button class="btn btn-danger" id="exitTrialBtn" title="退出试下">退出试下</button>
            <button class="btn" id="trialNextBtn" title="下一步">▶</button>
          </div>
        </div>
        <div class="legend">
          <div class="problem-nav">
            <span class="progress-text" id="progressText">0 / 0</span>
            <button class="btn btn-small" id="trialBtn" title="试下模式">试下</button>
          </div>
        </div>
      </div>
    `;
    // 渲染棋盘（WebBoard会自动挂载到board-root）
    const boardContainer = document.getElementById('board-root');
    if (boardContainer) {
      // 重新初始化board，指定容器
      this.board = new WebBoard(boardContainer);
      this.board.initialize({ size: 19, showCoordinates: true });
      this.board.render();
    }
    // 渲染导航器
    const navigatorContainer = document.getElementById('navigator-root');
    if (navigatorContainer) {
      this.boardNavigator = new BoardNavigator({
        container: navigatorContainer,
        maxMoves: 0,
        onPrev: () => {},
        onNext: () => {},
        onSliderChange: (value) => {},
      });
    }
    // 渲染答题面板
    const decisionContainer = document.getElementById('decision-root');
    if (decisionContainer) {
      this.decisionPanel = new DecisionPanel({
        container: decisionContainer,
        onSelect: (index) => this.selectAnswer(index),
        onNext: () => this.nextProblem(),
      });
    }
    // 绑定试下模式按钮事件
    const trialBtn = document.getElementById('trialBtn');
    trialBtn?.addEventListener('click', () => this.enterTrialMode());
    const exitTrialBtn = document.getElementById('exitTrialBtn');
    exitTrialBtn?.addEventListener('click', () => this.exitTrialMode());
  }
  destroy(): void {
    this.board.destroy();
    this.boardNavigator?.destroy();
    this.decisionPanel?.destroy();
    this.variationViewer?.destroy();
    this.decisionController.reset();
    this.trialController.reset();
    this.problems = [];
    this.currentProblem = null;
    this.initialized = false;
    this.inTrial = false;
  }
}
