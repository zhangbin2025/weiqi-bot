/**
 * AI 复盘页面主控制器
 * @module presentation/adapters/web/pages/review/ReviewPage
 *
 * 职责：组装子模块（ReviewInteraction / ReviewAnalysis / ReviewUI），
 *   持有核心组件（board / game / winrateChart），暴露页面生命周期接口。
 */
import { MoveNavigator } from '../../../../core/controllers';
import { WebBoard } from '../../components/Board';
import { BoardRebuilder, type MoveNumber } from '../../../../core/helpers/BoardRebuilder';
import { BoardSyncer } from '../../../../core/helpers/BoardSyncer';
import { Game } from '../../../../../domain/game';
import type { IPage, PageParams } from '../../../../core/interfaces';
import type { ReviewApp } from '../../../../../application/review';
import type { MoveReview } from '../../../../../services/review/types';
import type { PlayerColor } from '../../../../../domain/primitives';
import { playerColorToSGFColor } from '../../../../../domain/primitives';
import { WinrateChart } from './WinrateChart';
import type { VariationLayer } from './VariationManager';
import type { RecommendationCircle } from '../../components/BoardRenderer';
import type { IGameService } from '../../../../../services/game/IGameService';
import type { IFavoriteService } from '../../../../../services/favorite/IFavoriteService';
import { Dialog } from '@ui';
import { showLoading as showModelLoading, updateProgress as updateModelProgress, hideLoading as hideModelLoading, setLoadingText as setModelLoadingText } from '../../../../../clients/web/play/shared/ProgressManager';
import { ReviewInteraction, type PageMode } from './ReviewInteraction';
import { ReviewAnalysis, type AnalysisCompleteResult } from './ReviewAnalysis';
import { ReviewUI } from './ReviewUI';

/** 复盘页面配置 */
export interface ReviewPageConfig {
  reviewApp: ReviewApp;
  gameService?: IGameService;
  favoriteService?: IFavoriteService;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  modelManager?: any; // ModelManagementService
  aiController?: any; // AIController
}

/**
 * AI 复盘页面
 * 提供 AI 分析、胜率趋势图、候选着法推荐
 */
export class ReviewPage implements IPage {
  readonly title = 'AI 复盘';
  private reviewApp: ReviewApp;
  private modelManager?: any; // ModelManagementService
  private aiController?: any; // AIController
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;

  // 核心组件
  private board: WebBoard;
  private game: Game;
  private winrateChart: WinrateChart | null = null;

  // 控制器
  private moveNavigator: MoveNavigator;

  // 子模块
  private interaction: ReviewInteraction;
  private analysis: ReviewAnalysis;
  private ui: ReviewUI;

  // 状态
  private totalMoves = 0;
  private currentMove = 0;
  private moves: Array<{ x: number; y: number; color: PlayerColor }> = [];
  private handicapStones: Array<{ x: number; y: number; color: PlayerColor }> = [];
  private winrateTrend: Array<{ moveNumber: number; winRate: number; scoreLead: number }> = [];
  private analyzing = false;

  // 当前 AI 推荐
  private currentCandidates: Array<{ x: number; y: number; pv?: string[]; isCurrentMove?: boolean }> = [];
  private savedRecommendationCircles: RecommendationCircle[] = [];
  private currentModelName = 'AI 复盘分析';

  // 直播模式
  private isLiveMode = false;
  private liveUrl?: string;
  private liveInterval: number | undefined;
  private previousArchiveId?: string;
  private gameService: IGameService | undefined;
  private lastMovesCount = 0;

  constructor(config: ReviewPageConfig) {
    this.reviewApp = config.reviewApp;
    this.modelManager = config.modelManager;
    this.aiController = config.aiController;
    this.gameService = config.gameService;
    this.onNavigate = config.onNavigate;

    this.board = new WebBoard();
    this.game = new Game();
    this.moveNavigator = new MoveNavigator({
      maxMoves: 0,
      onMoveChange: (i) => this.goToMove(i),
    });

    // 创建子模块
    this.interaction = new ReviewInteraction(this.board, this.game, {
      onModeChange: (mode) => this.handleModeChange(mode),
      onStatusUpdate: (msg) => this.ui.updateStatus(msg),
      onDepthChange: (depth) => this.handleDepthChange(depth),
      onLayerChange: (layer) => this.handleLayerChange(layer),
      onUndoStateChanged: () => this.ui.updateUndoButtonState(this.interaction.isUndoDisabled()),
      onStonePlaced: () => { if (this.ui.isSoundEnabled()) this.reviewApp.playSound('stone'); },
      getCurrentMove: () => this.currentMove,
      onActualMoveClick: () => {
        // 点击实战落点圆圈：退出候选选点状态，goto 下一步
        this.interaction.exit();
        this.goToMove(this.currentMove + 1);
      },
    });

    this.ui = new ReviewUI({
      onPrevMove: () => this.prevMove(),
      onNextMove: () => this.nextMove(),
      onGoToMove: (m) => this.goToMove(m),
      onAnalyze: () => this.analyzeCurrentPosition(),
      onUndo: () => {
        this.interaction.undo();
        // 播放音效（撤回操作）
        if (this.ui.isSoundEnabled()) {
          this.reviewApp.playSound('stone');
        }
      },
      onExit: () => this.interaction.exit(),
      onToggleSound: () => this.toggleSound(),
      onFileSelect: (file) => this.handleFileSelect(file),
      onShowHistory: () => this.ui.showHistory(),
      onShowConfig: () => this.showConfigDialog(),
      onHandleKeyDown: (e) => this.handleKeyDown(e),
    });

    this.analysis = new ReviewAnalysis(
      this.reviewApp,
      {
        onProgress: (show) => this.ui.showProgress(show),
        onUpdateProgress: (p) => this.ui.updateProgress(p),
        onLoadingAnimation: (show) => this.ui.showLoadingAnimation(show),
        onUpdateLoadingText: (t) => this.ui.updateLoadingText(t),
        onStatusUpdate: (m) => this.ui.updateStatus(m),
        onAnalysisComplete: (r) => this.handleAnalysisComplete(r),
        onMoveAnalyzed: (m) => {},
      },
      config.gameService,
      config.favoriteService,
      this.modelManager,
      this.aiController,
    );
  }

  async initialize(): Promise<void> {
    // 设置 ModelManagementService 引用（用于读取全局模型配置）
    if (this.modelManager) {
      this.ui.setModelManager(this.modelManager);
    }
    
    await this.ui.loadConfig();

    this.analysis.setConfigVisits(this.ui.getConfigVisits());
    this.board.initialize({ size: 19, showCoordinates: true });
    this.board.on({ onClick: (pos) => this.interaction.handleBoardClick(pos.x, pos.y) });
    this.interaction.initVariationManager();
    this.ui.setupComponents();
    this.ui.bindEvents();
    
    // 禁用所有功能按钮（没有棋谱时）
    this.ui.disableAllButtons();
    
    // 初始化胜率图
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer) {
      this.winrateChart = new WinrateChart(chartContainer);
      this.winrateChart.setOnClick((moveNumber) => this.goToMove(moveNumber));
    }
  }

  handleParams(params: PageParams): void {
    // 直播模式：直接从URL抓取棋谱
    if (params['live'] === 'true' && params['url']) {
      this.isLiveMode = true;
      this.liveUrl = decodeURIComponent(params['url'] as string);
      console.info('[ReviewPage] 进入直播模式', { url: this.liveUrl });
      this.loadFromLiveUrl();
      return; // 直播模式不走其他参数处理
    }
    
    if (params['sgf']) {
      const sgf = decodeURIComponent(atob(params['sgf'] as string));
      this.loadAndAnalyze(sgf);
    }
    if (params['archiveId']) {
      const archiveId = params['archiveId'] as string;
      const taskId = params['taskId'] as string | undefined;
      this.loadFromArchiveId(archiveId, taskId);
    }
  }

  /**
   * 从直播URL抓取棋谱并加载
   */
  private async loadFromLiveUrl(): Promise<void> {
    if (!this.liveUrl || !this.gameService) return;
    
    try {
      console.info('[ReviewPage] 从直播URL抓取棋谱...');
      const result = await this.gameService.fetch(this.liveUrl, true); // forceRefresh=true 强制重新抓取
      
      if (!result.success || !result.archiveId) {
        console.error('[ReviewPage] 直播棋谱抓取失败:', result.error);
        return;
      }
      
      this.previousArchiveId = result.archiveId;
      console.info('[ReviewPage] 直播棋谱抓取成功:', result.archiveId);
      
      // 加载并分析棋谱
      await this.loadFromArchiveId(result.archiveId);
    } catch (error) {
      console.error('[ReviewPage] 直播棋谱加载异常', error);
    }
  }

  // ========== 公开接口 ==========

  async loadFromArchiveId(archiveId: string, taskId?: string): Promise<void> {
    await this.analysis.loadFromArchiveId(archiveId, taskId, this.moves);
  }

  async viewFavorite(archiveId: string): Promise<void> {
    await this.analysis.viewFavorite(archiveId);
  }

  async loadAndAnalyze(sgf: string): Promise<void> {
    await this.analysis.loadAndAnalyze(sgf, this.moves);
  }

  goToMove(moveNumber: number): void {
    if (moveNumber < 0 || moveNumber > this.totalMoves) return;
    this.currentMove = moveNumber;
    this.rebuildBoard(moveNumber);
    this.ui.updateDisplay(this.currentMove, this.totalMoves);
    this.ui.setSliderValue(moveNumber);
    this.winrateChart?.update(this.winrateTrend, this.currentMove);
  }

  prevMove(): void {
    const prevMoveIndex = this.currentMove - 1;
    this.goToMove(prevMoveIndex);
    // 播放音效（检查前一手是否是 pass）
    if (this.ui.isSoundEnabled() && prevMoveIndex >= 0 && prevMoveIndex < this.moves.length) {
      const prevMove = this.moves[prevMoveIndex];
      if (prevMove && (prevMove.x < 0 || prevMove.y < 0)) {
        this.reviewApp.playSound('pass');
      } else {
        this.reviewApp.playSound('stone');
      }
    }
  }
  nextMove(): void {
    const nextMoveIndex = this.currentMove + 1;
    this.goToMove(nextMoveIndex);
    // 播放音效（检查当前手是否是 pass）
    if (this.ui.isSoundEnabled() && nextMoveIndex >= 0 && nextMoveIndex < this.moves.length) {
      const currMove = this.moves[nextMoveIndex];
      if (currMove && (currMove.x < 0 || currMove.y < 0)) {
        this.reviewApp.playSound('pass');
      } else {
        this.reviewApp.playSound('stone');
      }
    }
  }

  toggleSound(): void {
    const enabled = this.ui.toggleSound();
    if (enabled) {
      this.reviewApp.initializeAudio();
    }
  }

  async analyzeCurrentPosition(): Promise<void> {
    if (!this.analysis.getReviewId() || this.analyzing) return;
    if (this.interaction.isMaxDepth()) {
      this.ui.updateStatus('已达最大探索深度');
      return;
    }

    this.ui.updateStatus('分析中...');
    this.analyzing = true;

    try {
      const moveIndex = this.currentMove;
      let moveReview: MoveReview | null = null;
      const visits = this.ui.getConfigVisits();

      // 判断当前是否在棋谱状态（非试下/路径状态）
      const isInGameMode = !this.interaction.isInTrial();

      if (!isInGameMode) {
        const allMoves = this.interaction.getCurrentMoves();
        moveReview = await this.reviewApp.analyzeMoves(allMoves, 7.5, { visits }, this.handicapStones);
      } else {
        moveReview = await this.reviewApp.analyzePosition(this.analysis.getReviewId()!, moveIndex, { visits, includePv: true });
      }

      if (moveReview?.candidates) {
        // 构建候选着法列表
        // 只有在棋谱状态下才获取棋谱下一手，用于判断实战命中
        const nextMove = isInGameMode && moveIndex < this.moves.length ? this.moves[moveIndex] : null;
        const candidates: Array<{
          x: number;
          y: number;
          winRate: number;
          scoreLead: number;
          visits: number;
          pv?: string[] | undefined;
          isHit: boolean;
          isActualMove: boolean;
        }> = [];

        // 检查下一手是否命中推荐选点
        let isHit = false;
        if (nextMove) {
          isHit = moveReview.candidates.some(c => c.x === nextMove.x && c.y === nextMove.y);
        }

        // 当前行棋方：白方行棋时需要把黑棋视角胜率转换成白棋视角
        const toPlayColor = nextMove?.color ?? (moveIndex % 2 === 0 ? 'black' : 'white');
        const isBlackToPlay = toPlayColor === 'black';

        // 添加推荐选点
        for (const c of moveReview.candidates) {
          const hit = nextMove ? (c.x === nextMove.x && c.y === nextMove.y) : false;
          candidates.push({
            x: c.x,
            y: c.y,
            winRate: isBlackToPlay ? c.winRate : (1 - c.winRate),
            scoreLead: isBlackToPlay ? c.scoreLead : -c.scoreLead,
            visits: c.visits,
            pv: c.pv,
            isHit: hit,
            isActualMove: hit,
          });
        }

        // 如果未命中且有下一手，添加实战落点
        if (!isHit && nextMove && nextMove.x >= 0 && nextMove.y >= 0) {
          // 从 winrateTrend 中获取下一手的胜率和目差（黑棋视角）
          const nextMoveData = this.winrateTrend.find(t => t.moveNumber === moveIndex + 1);
          const rawWinRate = nextMoveData?.winRate ?? 0;
          const rawScoreLead = nextMoveData?.scoreLead ?? 0;
          candidates.push({
            x: nextMove.x,
            y: nextMove.y,
            winRate: isBlackToPlay ? rawWinRate : (1 - rawWinRate),
            scoreLead: isBlackToPlay ? rawScoreLead : -rawScoreLead,
            visits: 0,
            pv: undefined,
            isHit: false,
            isActualMove: true,
          });
        }

        // 按当前行棋方胜率从高到低排序
        candidates.sort((a, b) => b.winRate - a.winRate);

        // 渲染列表
        this.renderCandidatesList(candidates, moveIndex);

        // 在棋盘上绘制推荐圆圈（包括命中的实战落点）
        const circles: RecommendationCircle[] = candidates
          .filter(c => !c.isActualMove || c.isHit) // 绘制推荐选点和命中的实战落点
          .map((c, i) => ({
            x: c.x,
            y: c.y,
            rank: i + 1,
            pv: c.pv,
            isActualMove: false, // 这些都是推荐圆圈
          }));

        // 如果有不在推荐中的实战落点，单独绘制红色虚线圆圈
        const actualMoveNotHit = candidates.find(c => c.isActualMove && !c.isHit);
        if (actualMoveNotHit) {
          circles.push({
            x: actualMoveNotHit.x,
            y: actualMoveNotHit.y,
            rank: 0,
            isActualMove: true,
          });
        }

        this.savedRecommendationCircles = circles;
        this.interaction.enterRecommendation(circles);
        this.ui.updateStatus('点击推荐选点查看变化图');
      } else {
        this.ui.updateStatus('');
      }
    } catch (error) {
      console.error('[ReviewPage] 局面分析失败', error as Error | undefined);
      this.ui.updateStatus('分析失败');
    } finally {
      this.analyzing = false;
      this.ui.showProgress(false);
    }
  }

  getDepth(): number { return this.interaction.getDepth(); }

  destroy(): void {
    // 停止直播模式
    this.stopLiveMode();
    
    this.board.destroy();
    this.winrateChart?.destroy();
    this.interaction.destroy();
    this.analysis.destroy();
    this.moveNavigator.destroy();
  }

  getAnalysisData(): Record<string, unknown> {
    return {
      reviewId: this.analysis.getReviewId(),
      totalMoves: this.totalMoves,
      currentMove: this.currentMove,
      moves: this.moves,
      winrateTrend: this.winrateTrend,
    };
  }

  // ========== 内部处理 ==========

  private handleModeChange(mode: PageMode): void {
    this.ui.updateUIForMode(mode);
    
    // 控制候选着法列表的显示/隐藏
    const candidatesList = document.getElementById('candidatesListCompact');
    const panelHeader = document.getElementById('panelHeader');
    const specialControlsButtons = document.querySelector('.special-controls-buttons') as HTMLElement;
    
    if (mode === 'recommendation') {
      // AI 推荐模式：显示标题行和候选着法列表，隐藏原来的按钮行
      if (candidatesList) candidatesList.style.display = 'flex';
      if (panelHeader) panelHeader.style.display = 'flex';
      if (specialControlsButtons) specialControlsButtons.style.display = 'none';
    } else {
      // 其他模式：隐藏标题行和候选着法列表，显示原来的按钮行
      if (candidatesList) candidatesList.style.display = 'none';
      if (panelHeader) panelHeader.style.display = 'none';
      if (specialControlsButtons) specialControlsButtons.style.display = 'flex';
    }
    
    switch (mode) {
      case 'trial':
        this.ui.updateStatus('试下模式 — 点击棋盘继续试下');
        break;
      case 'recommendation':
        this.ui.updateStatus('点击推荐选点查看变化图');
        break;
      case 'variation':
        this.ui.updateStatus('已进入选点变化图 — 点击圆圈继续或点击退出');
        break;
      case 'normal':
        this.currentCandidates = [];
        this.goToMove(this.currentMove);
        this.ui.updateStatus(this.currentModelName);
        break;
    }
  }

  private handleDepthChange(depth: number): void {
    this.ui.updateDepthIndicator(depth, this.interaction.MAX_DEPTH);
    this.ui.updateButtonsState(this.interaction.isMaxDepth());
    this.ui.updateUndoButtonState(this.interaction.isUndoDisabled());
  }

  private handleLayerChange(layer: VariationLayer): void {
    // 层级变化由 handleModeChange 统一处理状态文字，这里不再覆盖
  }

  private handleAnalysisComplete(result: AnalysisCompleteResult): void {
    this.totalMoves = result.totalMoves;
    this.winrateTrend = result.winrateTrend;
    if (result.moves.length > 0) {
      this.moves = result.moves;
    }
    
    // 获取让子信息
    const reviewId = this.analysis.getReviewId();
    if (reviewId) {
      const state = this.reviewApp.getState(reviewId);
      if (state) {
        this.handicapStones = state.handicapStones || [];
        // 初始化基础层时传入让子棋
        this.interaction.initializeBaseLayer(this.moves, this.handicapStones);
        this.ui.updateGameInfo(state.gameInfo.black, state.gameInfo.white, state.gameInfo.result);
      }
    }
    
    this.moveNavigator.setMaxMoves(this.totalMoves);
    this.ui.setSliderMax(this.totalMoves);
    this.winrateChart?.update(this.winrateTrend, this.totalMoves);
    this.goToMove(this.totalMoves);
    
    
    
    // 直播模式：只在首次记录初始手数并启动刷新
    if (this.isLiveMode) {
      if (this.lastMovesCount === 0) {
        this.lastMovesCount = this.totalMoves;
        console.info('[ReviewPage] 记录初始手数:', this.lastMovesCount);
      }
      if (!this.liveInterval) {
        this.startLiveMode();
      }
    }
    // 启用所有功能按钮（有棋谱时）
    this.ui.enableAllButtons();
  }

  private rebuildBoard(moveNumber: number): void {
    this.game.newGame({ size: 19 });
    
    // 放置让子棋
    if (this.handicapStones.length > 0) {
      // 转换颜色格式：PlayerColor ('black' | 'white') -> SGFColor ('B' | 'W')
      const sgfHandicapStones = this.handicapStones.map(s => ({
        x: s.x,
        y: s.y,
        color: playerColorToSGFColor(s.color),
      }));
      this.game.setHandicapStones(sgfHandicapStones);
    }
    
    // 处理着法（包括 Pass）
    if (moveNumber > 0 && this.moves.length > 0) {
      const movesToPlay = this.moves.slice(0, moveNumber);
      for (const move of movesToPlay) {
        // 检查是否为 Pass 着法
        if (move.x < 0 || move.y < 0) {
          this.game.pass();
        } else {
          this.game.placeStone(move.x, move.y);
        }
      }
    }
    BoardSyncer.sync(this.board, this.game, [], false);
  }

  render(): void {
    this.board.render();
  }

  private updateGameInfo(): void {
    const reviewId = this.analysis.getReviewId();
    if (!reviewId) return;
    const state = this.reviewApp.getState(reviewId);
    if (!state) return;
    this.ui.updateGameInfo(state.gameInfo.black, state.gameInfo.white, state.gameInfo.result);
  }

  private async handleFileSelect(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.sgf')) {
      await Dialog.alert('请选择 .sgf 格式的棋谱文件');
      return;
    }
    try {
      // 模型已在初始化时加载，无需等待
      const sgfContent = await this.ui.readFileContent(file);
      await this.loadAndAnalyze(sgfContent);
    } catch (error) {
      console.error('读取文件失败', error as Error | undefined);
      await Dialog.alert('读取文件失败,请重试');
    }
  }

  private async showConfigDialog(): Promise<void> {
    const oldModel = this.ui.getConfigModel();
    await this.ui.showConfigDialog(this.reviewApp, this.modelManager);
    this.analysis.setConfigVisits(this.ui.getConfigVisits());

    // 如果模型变化，不需要在标题栏显示模型文件名
    const newModel = this.ui.getConfigModel();
    if (newModel !== oldModel) {
      // 更新当前模型名称（内部使用，不在标题栏显示）
      this.currentModelName = newModel;
      
      // 从 aiController 获取引擎信息并更新
      if (this.aiController && typeof this.aiController.getEngineInfo === 'function') {
        const engineInfo = this.aiController.getEngineInfo();
        const backendInfo = {
          backend: engineInfo.backend || 'unknown',
          label: engineInfo.backend === 'native' ? 'NATIVE' :
                 engineInfo.backend === 'webgpu' ? 'WebGPU (GPU加速)' :
                 engineInfo.backend === 'webgl' ? 'WebGL (GPU加速)' :
                 engineInfo.backend === 'wasm' ? 'WASM (CPU多线程)' :
                 engineInfo.backend === 'cpu' ? 'CPU (纯CPU)' : engineInfo.backend
        };
        this.ui.updateBackendInfo(backendInfo);
      }
    }
  }

  /** 渲染候选着法列表 */
  private renderCandidatesList(
    candidates: Array<{
      x: number;
      y: number;
      winRate: number;
      scoreLead: number;
      visits: number;
      pv?: string[] | undefined;
      isHit: boolean;
      isActualMove: boolean;
    }>,
    moveIndex: number
  ): void {
    const container = document.getElementById('candidatesListCompact');
    if (!container) return;

    // 排名文字映射
    const rankTexts = ['一选', '二选', '三选', '四选', '五选', '六选', '七选', '八选', '九选', '十选'];

    // 表头
    let html = `
      <div class="candidates-header">
        <span class="col-hit">命中</span>
        <span class="col-rank">排名</span>
        <span class="col-coord">着法</span>
        <span class="col-winrate">胜率</span>
        <span class="col-score">目差</span>
      </div>
    `;

    // 统一渲染所有候选着法（已按胜率排序）
    let recommendationIndex = 0; // 推荐选点计数器
    html += candidates.map((c) => {
      const coord = this.coordToString(c.x, c.y);
      const winRatePercent = (c.winRate * 100).toFixed(1);
      const scoreLead = c.scoreLead.toFixed(1);
      const scoreText = c.scoreLead > 0 ? `+${scoreLead}` : scoreLead;
      
      // 第一列：如果是实战落子，打√
      const hitMark = c.isActualMove ? '✓' : '';
      
      // 第二列：排名
      let rankText: string;
      let className = 'candidate-compact';
      
      if (c.isActualMove && !c.isHit) {
        // 不在推荐中的实战落点
        rankText = '实战';
        className = 'candidate-compact actual-move';
      } else {
        // 推荐选点（包括在推荐中的实战落点）
        rankText = recommendationIndex < rankTexts.length ? rankTexts[recommendationIndex]! : `${recommendationIndex + 1}`;
        recommendationIndex++;
        if (c.isActualMove) {
          className = 'candidate-compact actual-in-recommend';
        }
      }
      
      // 如果是实战落子，添加 data-actual 属性
      const actualAttr = c.isActualMove && !c.isHit ? 'data-actual="true"' : '';

      return `<div class="${className}" data-x="${c.x}" data-y="${c.y}" data-pv="${c.pv?.join(',') || ''}" ${actualAttr}>
        <span class="col-hit">${hitMark}</span>
        <span class="col-rank">${rankText}</span>
        <span class="col-coord">${coord}</span>
        <span class="col-winrate">${winRatePercent}%</span>
        <span class="col-score">${scoreText}</span>
      </div>`;
    }).join('');

    container.innerHTML = html;

    // 绑定点击事件
    container.querySelectorAll('.candidate-compact').forEach(el => {
      el.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const x = parseInt(target.dataset['x']!, 10);
        const y = parseInt(target.dataset['y']!, 10);
        const isActual = target.dataset['actual'] === 'true';
        const pvStr = target.dataset['pv'];
        const pv = pvStr ? pvStr.split(',').filter(s => s.length > 0) : undefined;

        // 判断是否是单独的实战落点行（不在推荐中的实战落点）
        const isStandaloneActualMove = target.classList.contains('actual-move');

        if (isStandaloneActualMove) {
          // 点击单独的实战落点行（不在推荐中）：退出面板，goto 下一步
          this.interaction.exit();
          this.goToMove(moveIndex + 1);
        } else {
          // 点击推荐选点（包括在推荐中的实战落点）：显示变化图
          this.handleCandidateSelect(x, y, pv);
        }
      });
    });
  }

  /** 坐标转字符串 */
  private coordToString(x: number, y: number): string {
    const letter = String.fromCharCode(97 + x);
    const number = 19 - y;
    return `${letter}${number}`;
  }

  /** 处理候选着法选择 */
  private handleCandidateSelect(x: number, y: number, pv?: string[]): void {
    // 点击推荐选点，模拟点击棋盘，触发进入变化图模式
    this.interaction.handleBoardClick(x, y);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.goToMove(this.currentMove - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.goToMove(this.currentMove + 1);
        break;
      case 'Home':
        event.preventDefault();
        this.goToMove(0);
        break;
      case 'End':
        event.preventDefault();
        this.goToMove(this.totalMoves);
        break;
      case 'a':
      case 'A':
        if (!this.analyzing) {
          event.preventDefault();
          this.analyzeCurrentPosition();
        }
        break;
      case 'Escape':
        if (this.interaction.getMode() !== 'normal') {
          event.preventDefault();
          this.interaction.exit();
        }
        break;
      case 'z':
      case 'Z':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (this.interaction.isInTrial()) {
            this.interaction.undo();
          }
        }
        break;
    }
  }

  // ========== 直播模式 ==========

  private startLiveMode(): void {
    if (!this.isLiveMode || !this.liveUrl) return;
    
    console.info('[ReviewPage] 启动直播刷新（30秒间隔）');
    
    // 立即刷新一次
    this.refreshLiveGame();
    
    // 启动定时器
    this.liveInterval = window.setInterval(() => {
      this.refreshLiveGame();
    }, 30000);
  }

  private stopLiveMode(): void {
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = undefined as number | undefined;
    }
    this.isLiveMode = false;
    console.info('[ReviewPage] 停止直播模式');
  }

  private async refreshLiveGame(): Promise<void> {
    if (!this.liveUrl || !this.gameService) return;
    
    // 如果正在分析，跳过本次刷新
    if (this.analyzing) {
      console.info('[ReviewPage] 正在分析中，跳过直播刷新');
      return;
    }
    
    try {
      // 1. 先删除旧归档，强制重新抓取（避免缓存）
      if (this.previousArchiveId && this.gameService) {
        try {
          await (this.gameService as any).deleteArchive?.(this.previousArchiveId);
          console.info('[ReviewPage] 已删除旧归档（刷新前）:', this.previousArchiveId);
        } catch (e) {
          // 忽略删除失败
        }
      }
      
      // 2. 重新抓取棋谱（forceRefresh 跳过缓存）
      console.info('[ReviewPage] 开始刷新直播棋谱');
      const result = await this.gameService.fetch(this.liveUrl, true);
      
      if (!result.success || !result.archiveId) {
        console.warn('[ReviewPage] 刷新失败:', result.error);
        return;
      }
      
      // 2. 检测棋局结束
      if (result.metadata?.result && result.metadata.result !== '') {
        console.info('[ReviewPage] 棋局已结束，停止直播');
        this.stopLiveMode();
        return;
      }
      
      // 3. 获取新 SGF
      const newSgf = await this.gameService.getByArchiveId(result.archiveId);
      if (!newSgf) {
        console.warn('[ReviewPage] 获取新SGF失败');
        return;
      }
      
      // 4. 解析新手数
      const newMovesCount = this.parseMovesCount(newSgf);
      console.info('[ReviewPage] 调试:', { newMovesCount, lastMovesCount: this.lastMovesCount, archiveId: result.archiveId, previousArchiveId: this.previousArchiveId, sgfLength: newSgf.length });
      if (newMovesCount <= this.lastMovesCount) {
        console.info('[ReviewPage] 无新手数，跳过更新');
        return;
      }
      
      console.info('[ReviewPage] 检测到新手数:', this.lastMovesCount, '->', newMovesCount);
      
      // 5. 保存旧胜率数据（缓存）
      const oldWinrateTrend = [...this.winrateTrend];
      const oldMoves = [...this.moves];
      const oldTotalMoves = this.totalMoves;
      
      console.info('[ReviewPage] 使用缓存胜率数据，不重新分析');
      
      // 6. 解析新增着法，直接更新数据（不重新分析）
      const newMoves = this.parseNewMoves(newSgf, this.lastMovesCount);
      this.moves = [...oldMoves, ...newMoves];
      this.totalMoves = newMovesCount;
      this.lastMovesCount = newMovesCount;
      
      // 7. 更新胜率趋势（新手数使用最后一手的胜率）
      const lastWinrate = oldWinrateTrend[oldWinrateTrend.length - 1];
      if (lastWinrate) {
        for (let i = oldWinrateTrend.length; i < newMovesCount; i++) {
          this.winrateTrend.push({
            moveNumber: i + 1,
            winRate: lastWinrate.winRate,
            scoreLead: lastWinrate.scoreLead,
          });
        }
      }
      
      // 8. 旧归档已在步骤1删除
      
      // 9. 更新归档ID
      this.previousArchiveId = result.archiveId;
      
      // 10. 更新视图
      const currentMode = this.interaction.getMode();
      if (currentMode === 'normal') {
        // 如果用户在最新一手或接近最新，自动跳到新手数
        if (this.currentMove === oldTotalMoves - 1 || this.currentMove >= oldTotalMoves - 5) {
          this.goToMove(newMovesCount - 1);
        }
        
        // 更新胜率图
        if (this.winrateChart) {
          this.winrateChart.update(this.winrateTrend, this.currentMove);
        }
        
        // 更新 UI 显示
        this.ui.updateDisplay(this.currentMove, this.totalMoves);
        this.ui.setSliderMax(this.totalMoves);
        this.moveNavigator.setMaxMoves(this.totalMoves);
        
        console.info('[ReviewPage] 视图已更新（使用缓存数据）');
      } else {
        console.info('[ReviewPage] 当前模式', currentMode, '跳过视图更新（数据已更新）');
      }
      
    } catch (error) {
      console.error('[ReviewPage] 直播刷新异常', error);
    }
  }
  
  private parseMovesCount(sgf: string): number {
    // 简单统计 SGF 中的手数
    const moves = sgf.match(/[BW]\[[a-z]{0,2}\]/g);
    return moves ? moves.length : 0;
  }
  /**
   * 解析新增着法
   */
  private parseNewMoves(sgf: string, fromMove: number): Array<{ x: number; y: number; color: PlayerColor }> {
    const moves: Array<{ x: number; y: number; color: PlayerColor }> = [];
    const movePattern = /([BW])\[([a-z]{0,2})\]/g;
    let match;
    let moveIndex = 0;

    while ((match = movePattern.exec(sgf)) !== null) {
      const color = match[1] === 'B' ? 'black' : 'white';
      const pos = match[2];

      if (moveIndex < fromMove) {
        moveIndex++;
        continue;
      }

      if (pos && pos.length === 2) {
        const x = pos.charCodeAt(0) - 97;
        const y = pos.charCodeAt(1) - 97;
        if (x >= 0 && x < 19 && y >= 0 && y < 19) {
          moves.push({ x, y, color });
        }
      } else if (pos === '' || pos === 'tt') {
        moves.push({ x: -1, y: -1, color });
      }

      moveIndex++;
    }

    console.info('[ReviewPage] 解析新增着法:', moves.length, '手');
    return moves;
  }


}
