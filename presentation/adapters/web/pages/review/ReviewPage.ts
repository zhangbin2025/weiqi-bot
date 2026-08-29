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
import { playerColorToSGFColor, sgfColorToPlayerColor } from '../../../../../domain/primitives';
import { SGFParser } from '../../../../../domain/sgf/SGFParser';
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
import { LiveModeManager } from './LiveModeManager';

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
  // 分析局面模式（只分析指定局面，不分析整局）
  private analyzePositionMode = false;

  // 子模块
  private interaction: ReviewInteraction;
  private analysis: ReviewAnalysis;
  private ui: ReviewUI;
  // 直播模式AI选点显示开关
  private showLiveRecommendationsEnabled = true;
  // 防止重复调用showLiveRecommendations
  // 缓存直播最后一手的推荐圆圈（goToMove恢复用）
  private savedLiveCircles: RecommendationCircle[] = [];
  private showingLiveRecommendations = false;

  // 状态
  private totalMoves = 0;
  private currentMove = 0;
  private moves: Array<{ x: number; y: number; color: PlayerColor }> = [];
  private handicapStones: Array<{ x: number; y: number; color: PlayerColor }> = [];
  private winrateTrend: Array<{ moveNumber: number; winRate: number; scoreLead: number }> = [];
  private analyzing = false;

  // 框选区域状态
  private hasRegionSelection = false;

  // 当前 AI 推荐
  private currentCandidates: Array<{ x: number; y: number; pv?: string[]; isCurrentMove?: boolean }> = [];
  private savedRecommendationCircles: RecommendationCircle[] = [];
  private currentModelName = 'AI 复盘分析';

  // 从直播跳转复盘时待选中的选点坐标（如 q16）
  private pendingSelectCoord: string | null = null;

  // 服务
  private gameService: IGameService | undefined;
  private favoriteService: IFavoriteService | undefined;

  // 直播模式管理器
  private liveModeManager?: LiveModeManager;

  // SGF 解析器（用于非直播场景）
  private sgfParser: SGFParser;

  constructor(config: ReviewPageConfig) {
    this.reviewApp = config.reviewApp;
    this.modelManager = config.modelManager;
    this.aiController = config.aiController;
    this.gameService = config.gameService;
    this.favoriteService = config.favoriteService; // 保存引用
    this.onNavigate = config.onNavigate;

    this.sgfParser = new SGFParser();

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
      isReadOnlyMode: () => this.liveModeManager?.wasLive() ?? false, // 直播模式只读（结束后仍禁止复盘）
      onLiveCircleClick: (circle) => this.handleLiveCircleClick(circle),
      onRestoreCandidates: (html) => this.restoreCandidatesTable(html),
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
      onToggleLiveRecommendations: () => this.toggleLiveRecommendations(),
      onRefreshIntervalChange: (seconds) => this.liveModeManager?.setRefreshInterval(seconds),
      onToggleRegionSelection: () => {
        if (this.hasRegionSelection) {
          // 清除框选
          this.interaction.clearRegionSelection();
          this.hasRegionSelection = false;
          this.ui.updateRegionSelectionStatus(false);
        } else {
          // 开始框选
          this.interaction.startRegionSelection();
        }
      },
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
    this.board.on({ onClick: (pos) => this.handleBoardClick(pos.x, pos.y) });
    this.interaction.initVariationManager();
    this.ui.setupComponents();
    this.ui.bindEvents();

    // 初始化直播模式管理器
    if (this.gameService && this.favoriteService) {
      this.liveModeManager = new LiveModeManager(
        this.gameService,
        this.favoriteService,
        this.reviewApp,
        this.analysis,
        {
          updateStatus: (msg) => this.ui.updateStatus(msg),
          updateDisplay: (current, total) => this.ui.updateDisplay(current, total),
          goToMove: (moveNumber) => this.goToMove(moveNumber),
          updateWinrateChart: (trend, current) => this.winrateChart?.update(trend, current),
          getCurrentMove: () => this.currentMove,
          getTotalMoves: () => this.totalMoves,
          getWinrateTrend: () => this.winrateTrend,
          setWinrateTrend: (trend) => { this.winrateTrend = trend; },
          getMoves: () => this.moves,
          setMoves: (moves) => { this.moves = moves; },
          setTotalMoves: (total) => { this.totalMoves = total; },
          setHandicapStones: (stones) => { this.handicapStones = stones; },
          showLiveRecommendations: (moveIndex) => this.showLiveRecommendations(moveIndex),
          onAnalysisComplete: (result) => this.handleAnalysisComplete(result),
        },
      );
    }

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
    // 分析局面模式：只分析指定局面（不分析整局）
    if (params['analyzePosition'] === 'true' && params['archiveId'] && params['moveTo']) {
      const archiveId = params['archiveId'] as string;
      const moveTo = parseInt(params['moveTo'] as string, 10);
      console.info('[ReviewPage] 进入分析局面模式', { archiveId, moveTo });
      this.analyzePositionMode = true;
      // 隐藏胜率图
      this.ui.hideChart();
      // 禁用滑条和前进后退按钮
      this.ui.disableNavigation();
      // 加载棋谱并跳转到指定局面
      this.loadFromArchiveId(archiveId, undefined, undefined, true).then((success) => {
        if (success) {
          this.goToMove(moveTo);
        } else {
          this.ui.updateStatus('加载棋谱失败');
        }
      }).catch((err) => {
        console.error('[ReviewPage] loadFromArchiveId 错误:', err);
        this.ui.updateStatus('加载棋谱失败');
      });
      return;
    }
    // 直播模式：交给 LiveModeManager 处理
    if (params['live'] === 'true' && params['url']) {
      const liveUrl = decodeURIComponent(params['url'] as string);
      console.info('[ReviewPage] 进入直播模式', { url: liveUrl });
      // 直播模式：隐藏菜单按钮
      this.ui.setLiveMode(true);
      this.ui.showLiveModeIndicator();
      // 交给 LiveModeManager 处理
      if (this.liveModeManager) {
        this.liveModeManager.loadFromUrl(liveUrl);
      }
      return; // 直播模式不走其他参数处理
    }
    
    // 收藏模式：从归档ID查看复盘结果
    if (params['view'] === 'favorite' && params['key']) {
      this.viewFavorite(params['key'] as string);
      // 从直播进入复盘，显示返回直播按钮
      if (params['live']) {
        const liveUrl = decodeURIComponent(params['live'] as string);
        this.ui.showBackToLive(liveUrl);
      }
      // 保存待选中的选点坐标，等分析完成后自动选中
      if (params['select']) {
        this.pendingSelectCoord = params['select'] as string;
      }
      return;
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
  // ========== 公开接口 ==========

  async loadFromArchiveId(archiveId: string, taskId?: string, baseMoves?: Array<{ x: number; y: number; color: PlayerColor }>, skipAnalysis?: boolean): Promise<boolean> {
    return await this.analysis.loadFromArchiveId(archiveId, taskId, baseMoves || this.moves, skipAnalysis);
  }
  async viewFavorite(archiveId: string): Promise<void> {
    // 从直播进入复盘，恢复 UI 控件
    this.ui.setLiveMode(false);
    await this.analysis.viewFavorite(archiveId);
  }

  async loadAndAnalyze(sgf: string): Promise<void> {
    await this.analysis.loadAndAnalyze(sgf, this.moves);
  }

  goToMove(moveNumber: number): void {
    if (this.analyzing) return;
    if (moveNumber < 0 || moveNumber > this.totalMoves) return;
    this.currentMove = moveNumber;
    this.rebuildBoard(moveNumber);
    this.ui.updateDisplay(this.currentMove, this.totalMoves);
    this.ui.setSliderValue(moveNumber);
    this.winrateChart?.update(this.winrateTrend, this.currentMove);
    // 直播模式：回到最后一手时恢复推荐圆圈，浏览前面着法时清除
    if (this.liveModeManager?.isActive() || this.savedLiveCircles.length > 0) {
      if (this.currentMove === this.totalMoves && this.savedLiveCircles.length > 0 && this.showLiveRecommendationsEnabled) {
        this.board.setRecommendationCircles(this.savedLiveCircles);
      }
    }
  }

  prevMove(): void {
    if (this.analyzing) return;
    // 分析局面模式：禁用手动浏览
    if (this.analyzePositionMode) return;
    // 直播进行中不允许手动浏览
    if (this.liveModeManager?.isActive()) return;
    
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
    // 分析局面模式：禁用手动浏览
    if (this.analyzePositionMode) return;
    if (this.analyzing) return;
    // 直播进行中不允许手动浏览
    if (this.liveModeManager?.isActive()) return;
    
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
    
    // 直播模式：按钮文本为"研究"时，location 跳转到复盘条目
    const aiBtn = document.getElementById("aiRecommendBtn") || document.getElementById("aiBtn");
    const btnText = aiBtn?.textContent?.trim();
    console.info("[ReviewPage] AI按钮点击, text:", JSON.stringify(btnText), "el:", !!aiBtn);
    if (btnText && btnText !== "AI") {
      const archiveId = this.liveModeManager?.getArchiveId();
      console.info("[ReviewPage] 研究模式, archiveId:", archiveId);
      if (archiveId) {
        const liveUrl = this.liveModeManager?.getLiveUrl();
        window.location.href = "?view=favorite&key=" + archiveId + (liveUrl ? "&live=" + encodeURIComponent(liveUrl) : "");
      } else {
        this.ui.updateStatus("无复盘归档数据");
        console.warn("[ReviewPage] 研究模式但无 archiveId");
      }
      return;
    }

    if (this.interaction.isMaxDepth()) {
      this.ui.updateStatus('已达最大探索深度');
      return;
    }

    this.ui.updateStatus('分析中...');
    this.analyzing = true;

    this.ui.setButtonsEnabled(false);
    try {
      const moveIndex = this.currentMove;
      let moveReview: MoveReview | null = null;
      const visits = this.ui.getConfigVisits();

      // 判断当前是否在棋谱状态（非试下/路径状态）
      const isInGameMode = !this.interaction.isInTrial();

      if (!isInGameMode) {
        const allMoves = this.interaction.getCurrentMoves();
        const roi = this.interaction.getRegionOfInterest();
                moveReview = await this.reviewApp.analyzeMoves(allMoves, 7.5, { visits, regionOfInterest: roi }, this.handicapStones);
      } else {
        const roi = this.interaction.getRegionOfInterest();
                moveReview = await this.reviewApp.analyzePosition(this.analysis.getReviewId()!, moveIndex, { visits, includePv: true, regionOfInterest: roi });
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
        const toPlayColor = this.game.getState().currentPlayer;
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

        // 实战落点不再单独添加到候选列表

        // 按当前行棋方胜率从高到低排序
        candidates.sort((a, b) => b.winRate - a.winRate);

        // 渲染列表
        this.renderCandidatesList(candidates, moveIndex);

        // 判断下一着颜色
        const nextColor: PlayerColor = this.game.getState().currentPlayer;

        // 在棋盘上绘制推荐圆圈（包括命中的实战落点）
        const circles: RecommendationCircle[] = candidates
          .filter(c => !c.isActualMove || c.isHit) // 绘制推荐选点和命中的实战落点
          .map((c, i) => ({
            x: c.x,
            y: c.y,
            rank: i + 1,
            pv: c.pv,
            isActualMove: false, // 这些都是推荐圆圈
            nextColor,
          }));

        // 实战落点不再绘制红色虚线圆圈

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
      this.ui.setButtonsEnabled(true);
      this.analyzing = false;
      this.ui.showProgress(false);
    }
  }

  getDepth(): number { return this.interaction.getDepth(); }

  destroy(): void {
    // 停止直播模式
    this.liveModeManager?.stop();
    this.ui.hideLiveModeIndicator();
    
    this.board.destroy();
    this.winrateChart?.destroy();
    this.interaction.destroy();
    this.analysis.destroy();
    this.moveNavigator.destroy();
  }


  /**
   * 直播模式下点击推荐圆圈 → 跳转复盘页面并带上选点坐标
   */
  private handleLiveCircleClick(circle: RecommendationCircle): void {
    const archiveId = this.liveModeManager?.getArchiveId();
    if (!archiveId) return;

    // 坐标转字符串（如 q16）
    const coordStr = this.coordToString(circle.x, circle.y);

    const liveUrl = this.liveModeManager?.getLiveUrl();
    let url = `?view=favorite&key=${archiveId}&select=${coordStr}`;
    if (liveUrl) {
      url += `&live=${encodeURIComponent(liveUrl)}`;
    }
    window.location.href = url;
  }

  /**
   * 从直播跳转复盘后，自动分析最后局面并选中指定选点进入变化图
   */
  private async autoSelectCandidate(coordStr: string): Promise<void> {
    // 解析坐标（如 q16 -> x=16, y=3）
    const x = coordStr.charCodeAt(0) - 97;  // a=0, b=1, ...
    const y = 19 - parseInt(coordStr.substring(1), 10);

    if (x < 0 || x >= 19 || y < 0 || y >= 19) {
      console.warn('[ReviewPage] autoSelectCandidate: 无效坐标', coordStr);
      return;
    }

    // 跳到最后一手
    this.goToMove(this.totalMoves);

    // 分析最后局面
    this.ui.updateStatus('分析中...');
    this.analyzing = true;

    this.ui.setButtonsEnabled(false);
    try {
      const moveReview = await this.reviewApp.analyzePosition(
        this.analysis.getReviewId()!,
        this.totalMoves,
        { visits: this.ui.getConfigVisits(), includePv: true, regionOfInterest: this.interaction.getRegionOfInterest() }
      );

      if (moveReview?.candidates) {
        const toPlayColor = this.game.getState().currentPlayer;
        const isBlackToPlay = toPlayColor === 'black';
        const nextColor: PlayerColor = toPlayColor;

        // 构建候选着法
        const nextMove = this.totalMoves < this.moves.length ? this.moves[this.totalMoves] : null;
        const candidates = moveReview.candidates.map(c => {
          const hit = nextMove ? (c.x === nextMove.x && c.y === nextMove.y) : false;
          return {
            x: c.x, y: c.y,
            winRate: isBlackToPlay ? c.winRate : (1 - c.winRate),
            scoreLead: isBlackToPlay ? c.scoreLead : -c.scoreLead,
            visits: c.visits,
            pv: c.pv,
            isHit: hit,
            isActualMove: hit,
          };
        }).sort((a, b) => b.winRate - a.winRate);

        // 渲染候选列表
        this.renderCandidatesList(candidates, this.totalMoves);

        // 构建圆圈
        const circles: RecommendationCircle[] = candidates
          .filter(c => !c.isActualMove || c.isHit)
          .map((c, i) => ({
            x: c.x, y: c.y,
            rank: i + 1,
            pv: c.pv,
            isActualMove: false,
            nextColor,
          }));

        this.savedRecommendationCircles = circles;

        // 找到目标选点并自动进入变化图
        const targetCircle = circles.find(c => c.x === x && c.y === y);
        if (targetCircle) {
          this.interaction.enterRecommendation(circles);
          // 自动点击目标选点，进入变化图
          this.interaction.handleBoardClick(x, y);
        } else {
          // 选点不在推荐中，仍进入推荐模式显示所有圆圈
          this.interaction.enterRecommendation(circles);
          this.ui.updateStatus('选点不在推荐中，请重新选择');
        }
      } else {
        this.ui.updateStatus('分析无结果');
      }
    } catch (error) {
      console.error('[ReviewPage] 自动选点分析失败', error as Error | undefined);
      this.ui.updateStatus('分析失败');
    } finally {
      this.ui.setButtonsEnabled(true);
      this.analyzing = false;
      this.ui.showProgress(false);
    }
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
        // 恢复到退出推荐模式前的步数
        const restoredMoveCount = this.interaction.restoredMoveCount;
        if (restoredMoveCount > 0 && restoredMoveCount !== this.currentMove) {
          this.currentMove = restoredMoveCount;
          this.ui.updateDisplay(this.currentMove, this.totalMoves);
          this.ui.setSliderValue(this.currentMove);
          this.winrateChart?.update(this.winrateTrend, this.currentMove);
        }
        this.ui.updateStatus(this.liveModeManager?.isActive() ? '直播中' : this.currentModelName);
        break;
    }
  }

  private handleDepthChange(depth: number): void {
    this.ui.updateDepthIndicator(depth, this.interaction.MAX_DEPTH, (targetDepth) => {
      // 滑条变化，跳转到对应深度
      if (targetDepth < depth) {
        this.interaction.exitToDepth(targetDepth);
      }
    });
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
    
    // 直播模式：等AI选点分析完成，再启动定时刷新
    if (this.liveModeManager?.isActive()) {
      this.analyzing = false; // 重置分析状态
      this.ui.updateStatus('直播中');
      console.info('[ReviewPage] 增量分析完成，胜率已更新');
      // start() 已有定时器时不覆盖，不会和 scheduleNextRefresh 冲突
      if (this.showLiveRecommendationsEnabled && this.totalMoves > 0) {
        this.showLiveRecommendations(this.totalMoves).then(() => {
          this.liveModeManager?.start();
        });
      } else {
        this.liveModeManager?.start();
      }
    } else {
      this.ui.updateStatus('点击推荐选点查看变化图');
    }
    // 启用所有功能按钮（有棋谱时）
    // 分析局面模式：不启用导航控件
    if (!this.analyzePositionMode) {
      this.ui.enableAllButtons();
    }

    // 如果有待选中的选点（从直播跳转过来），自动分析并选中
    if (this.pendingSelectCoord) {
      const coord = this.pendingSelectCoord;
      this.pendingSelectCoord = null;
      this.autoSelectCandidate(coord);
    }
  }


  /**
   * 直播模式：显示最后一手棋的AI选点
   */
  private async showLiveRecommendations(moveIndex: number): Promise<void> {
    if (!this.showLiveRecommendationsEnabled) return;
    if (!this.analysis.getReviewId() || this.showingLiveRecommendations) return;
    
    this.showingLiveRecommendations = true;
    this.savedLiveCircles = [];
    this.board.setRecommendationCircles([]);
    // DEBUG: 对比 ReviewPage.moves 和 ReviewService.data.moves
    console.info('[ReviewPage] DEBUG showLiveRecommendations: moveIndex=', moveIndex, 'totalMoves=', this.totalMoves, 'moves.length=', this.moves.length);
    console.info('[ReviewPage] DEBUG last 5 moves:', JSON.stringify(this.moves.slice(-5).map(m => ({x:m.x, y:m.y, c:m.color}))));
    console.info('[ReviewPage] 开始分析局面', moveIndex, '的AI选点');
    
    try {
      const moveReview = await this.reviewApp.analyzePosition(
        this.analysis.getReviewId()!,
        moveIndex,
        { visits: this.ui.getConfigVisits(), regionOfInterest: this.interaction.getRegionOfInterest() }
      );
      
      if (moveReview?.candidates && moveReview.candidates.length > 0) {
        // 判断下一着是谁下：根据当前手数判断
        // moveIndex是当前局面已下的手数（从0开始）
        // 如果已下偶数手（0, 2, 4...），下一手是黑棋
        // 如果已下奇数手（1, 3, 5...），下一手是白棋
        const nextColor: 'black' | 'white' = this.game.getState().currentPlayer;
        
        // 只取前5个候选
        const circles: RecommendationCircle[] = moveReview.candidates
          .slice(0, 5)
          .map((c, i) => ({
            x: c.x,
            y: c.y,
            rank: i + 1,
            isActualMove: false,
            nextColor,  // 添加下一着颜色
          }));
        
        // 只绘制圆圈，不进入推荐模式
        this.board.setRecommendationCircles(circles);
        this.savedLiveCircles = circles;
        console.info('[ReviewPage] 直播模式：已显示AI选点', circles.length, '个，下一着:', nextColor);
      } else {
        console.warn('[ReviewPage] 没有获取到候选选点');
      }
    } catch (error) {
      console.warn('[ReviewPage] 获取AI选点失败', error);
    } finally {
      this.showingLiveRecommendations = false;
    }
  }
  
  /**
   * 切换直播模式AI选点显示
   */
  toggleLiveRecommendations(): void {
    this.showLiveRecommendationsEnabled = !this.showLiveRecommendationsEnabled;
    this.ui.updateLiveRecommendationsStatus(this.showLiveRecommendationsEnabled);
    
    if (!this.showLiveRecommendationsEnabled) {
      // 关闭时清除圆圈
      this.board.setRecommendationCircles([]);
    } else if (this.liveModeManager?.isActive() && this.totalMoves > 0) {
      // 开启时重新显示
      this.showLiveRecommendations(this.totalMoves);
    }
  }

  private rebuildBoard(moveNumber: number): void {
    // 清除AI选点圆圈，避免与落子冲突
    this.board.setRecommendationCircles([]);
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
      
      if (false && c.isActualMove && !c.isHit) {
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
  /** 恢复候选选点表格（从状态栈退出时调用） */
  private restoreCandidatesTable(html: string): void {
    const container = document.getElementById("candidatesListCompact");
    if (container) {
      container.innerHTML = html;
      // 重新绑定点击事件
      container.querySelectorAll(".candidate-compact").forEach(el => {
        el.addEventListener("click", (e) => {
          const target = e.currentTarget as HTMLElement;
          const x = parseInt(target.dataset["x"]!, 10);
          const y = parseInt(target.dataset["y"]!, 10);
          const isActual = target.dataset["actual"] === "true";
          const pvStr = target.dataset["pv"];
          const pv = pvStr ? pvStr.split(",").filter(s => s.length > 0) : undefined;
          const isStandaloneActualMove = target.classList.contains("actual-move");
          if (isStandaloneActualMove) {
            this.interaction.exit();
            this.goToMove(this.currentMove + 1);
          } else {
            this.handleCandidateSelect(x, y, pv);
          }
        });
      });
    }
  }

  /** 处理棋盘点击（封装 analyzing 检查） */
  private handleBoardClick(x: number, y: number): void {
    if (this.analyzing) return;

    // 如果正在框选
    if (this.interaction.isSelecting()) {
      const completed = this.interaction.handleRegionSelectionClick(x, y);
      if (completed) {
        this.hasRegionSelection = true;
        this.ui.updateRegionSelectionStatus(true);
      }
      return;
    }

    // 试下模式：检查是否在区域内
    if (!this.interaction.isInRegion(x, y)) {
      this.ui.updateStatus("只能在框选区域内试下");
      return;
    }

    this.interaction.handleBoardClick(x, y);
  }
  private handleKeyDown(event: KeyboardEvent): void {
    if (this.analyzing) {
      event.preventDefault();
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    switch (event.key) {
      case 'ArrowLeft':
        if (this.interaction.getMode() === 'normal') {
          event.preventDefault();
          this.goToMove(this.currentMove - 1);
        }
        break;
      case 'ArrowRight':
        if (this.interaction.getMode() === 'normal') {
          event.preventDefault();
          this.goToMove(this.currentMove + 1);
        }
        break;
      case 'Home':
        if (this.interaction.getMode() === 'normal') {
          event.preventDefault();
          this.goToMove(0);
        }
        break;
      case 'End':
        if (this.interaction.getMode() === 'normal') {
          event.preventDefault();
          this.goToMove(this.totalMoves);
        }
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
      case 'Enter':
        if (!this.analyzing) {
          event.preventDefault();
          this.analyzeCurrentPosition();
        }
        break;
    }
  }

  
  /**
   * 使用 SGFParser 解析 SGF，返回完整着法列表
   * （与 ReviewService.loadFromSGF 的解析逻辑一致）
   */
  private parseAllMoves(sgf: string): Array<{ x: number; y: number; color: PlayerColor }> {
    try {
      const parsed = this.sgfParser.parse(sgf);
      return parsed.moves.map((m) => {
        if (!m.coord || m.coord.length < 2) {
          return { x: -1, y: -1, color: sgfColorToPlayerColor(m.color as 'B' | 'W') };
        }
        return {
          x: m.coord.charCodeAt(0) - 97,
          y: m.coord.charCodeAt(1) - 97,
          color: sgfColorToPlayerColor(m.color as 'B' | 'W'),
        };
      });
    } catch (e) {
      console.warn('[ReviewPage] SGF解析失败:', e);
      return [];
    }
  }

  /**
   * 检测着法列表末尾是否有双 Pass（对局结束标志）
   * 围棋规则：双方连续 Pass 表示对局结束，进入数子阶段
   */
  private isDoublePassAtEnd(moves: Array<{ x: number; y: number; color: PlayerColor }>): boolean {
    const len = moves.length;
    if (len < 2) return false;
    const last = moves[len - 1]!;
    const secondLast = moves[len - 2]!;
    // Pass 着法: x < 0 || y < 0
    const lastIsPass = last.x < 0 || last.y < 0;
    const secondLastIsPass = secondLast.x < 0 || secondLast.y < 0;
    // 双 Pass 且颜色不同（一黑一白）
    return lastIsPass && secondLastIsPass && last.color !== secondLast.color;
  }

  /**
   * 从着法列表格式化对局结果描述
   */
  private formatGameResult(moves: Array<{ x: number; y: number; color: PlayerColor }>): string {
    // 去掉末尾的 Pass，统计有效手数
    let effectiveMoves = moves.length;
    // 末尾双 Pass 不算有效手数
    if (moves.length >= 2 && this.isDoublePassAtEnd(moves)) {
      effectiveMoves -= 2;
    }
    return effectiveMoves + '手';
  }

  /**
   * 使用 SGFParser 正确解析 SGF，获取着法总数
   * （避免简单正则误匹配让子棋 AB[xx] 等属性）
   */
  private parseMovesCount(sgf: string): number {
    try {
      const parsed = this.sgfParser.parse(sgf);
      return parsed.moves.length;
    } catch (e) {
      console.warn('[ReviewPage] SGF解析失败，fallback到正则:', e);
      const moves = sgf.match(/[BW]\[[a-z]{0,2}\]/g);
      return moves ? moves.length : 0;
    }
  }

  /**
   * 使用 SGFParser 正确解析 SGF，提取新增着法
   * （避免简单正则误匹配让子棋 AB[xx] 等属性）
   */
  private parseNewMoves(sgf: string, fromMove: number): Array<{ x: number; y: number; color: PlayerColor }> {
    try {
      const parsed = this.sgfParser.parse(sgf);
      const allMoves: Array<{ x: number; y: number; color: PlayerColor }> = parsed.moves.map((m) => {
        if (!m.coord || m.coord.length < 2) {
          return { x: -1, y: -1, color: sgfColorToPlayerColor(m.color as 'B' | 'W') };
        }
        return {
          x: m.coord.charCodeAt(0) - 97,
          y: m.coord.charCodeAt(1) - 97,
          color: sgfColorToPlayerColor(m.color as 'B' | 'W'),
        };
      });

      const newMoves = allMoves.slice(fromMove);
      console.info('[ReviewPage] 解析新增着法:', newMoves.length, '手（总共', allMoves.length, '手，从第', fromMove + 1, '手开始）');
      return newMoves;
    } catch (e) {
      console.warn('[ReviewPage] SGF解析失败，fallback到正则:', e);
      // fallback: 使用简单正则（兼容异常 SGF）
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

      console.info('[ReviewPage] 解析新增着法(fallback):', moves.length, '手');
      return moves;
    }
  }


}
