/**
 * 复盘分析编排 + 数据持久化
 * @module presentation/adapters/web/pages/review/ReviewAnalysis
 */
import type { ReviewApp } from '../../../../../application/review';
import type { IModelManagementService } from '../../../../../services/model';
import type { IAIController } from '../../../../../services/ai/IAIController';
import type { BadMove, MoveReview } from '../../../../../services/review/types';
import type { PlayerColor } from '../../../../../domain/primitives';
import type { IGameService } from '../../../../../services/game/IGameService';
import type { IFavoriteService } from '../../../../../services/favorite/IFavoriteService';
import { RecorderHistoryManager } from '../../../../../application/recorder/RecorderHistoryManager';
import { TaskHelper } from '../../../../../clients/web/shared/task-helper';

/** 分析编排回调 */
export interface AnalysisCallbacks {
  onProgress: (show: boolean) => void;
  onUpdateProgress: (percent: number) => void;
  onLoadingAnimation: (show: boolean) => void;
  onUpdateLoadingText: (text: string) => void;
  onStatusUpdate: (msg: string) => void;
  onAnalysisComplete: (result: AnalysisCompleteResult) => void;
  onMoveAnalyzed: (move: MoveReview) => void;
}

/** 分析完成结果 */
export interface AnalysisCompleteResult {
  totalMoves: number;
  badMoves: BadMove[];
  winrateTrend: Array<{ moveNumber: number; winRate: number; scoreLead: number }>;
  moves: Array<{ x: number; y: number; color: PlayerColor }>;
}

/**
 * 复盘分析管理器
 *
 * 管理分析编排（loadAndAnalyze, startAnalysis, loadFromArchiveId, viewFavorite）
 * 和数据持久化（saveReviewData, loadSavedReviewData）。
 */
export class ReviewAnalysis {
  private reviewApp: ReviewApp;
  private modelManager?: IModelManagementService | undefined;
  private aiController?: IAIController | undefined;
  private gameService?: IGameService | undefined;
  private favoriteService?: IFavoriteService | undefined;
  private historyManager?: RecorderHistoryManager;
  private callbacks: AnalysisCallbacks;

  /** 当前复盘 ID */
  private reviewId: string | null = null;
  /** 当前归档 ID */
  private currentArchiveId: string | null = null;
  /** 是否正在分析 */
  private analyzing = false;

  /** 分析局面用的 visits（用户可配） */
  private configVisits = 200;

  constructor(
    reviewApp: ReviewApp,
    callbacks: AnalysisCallbacks,
    gameService?: IGameService,
    favoriteService?: IFavoriteService,
    modelManager?: IModelManagementService,
    aiController?: IAIController,
  ) {
    this.reviewApp = reviewApp;
    this.callbacks = callbacks;
    this.gameService = gameService;
    this.favoriteService = favoriteService;
    this.modelManager = modelManager;
    this.aiController = aiController;
    if (this.gameService && this.favoriteService) {
      this.historyManager = new RecorderHistoryManager(
        this.gameService,
        this.favoriteService,
        'review_data',
      );
    }
  }

  /** 获取 reviewId */
  getReviewId(): string | null { return this.reviewId; }

  /** 获取 currentArchiveId */
  getCurrentArchiveId(): string | null { return this.currentArchiveId; }

  /** 更新当前归档 ID（用于直播刷新） */
  setCurrentArchiveId(archiveId: string): void {
    this.currentArchiveId = archiveId;
  }

  /** 是否正在分析 */
  isAnalyzing(): boolean { return this.analyzing; }

  /** 设置配置 */
  setConfigVisits(visits: number): void { this.configVisits = visits; }

  /** 从归档 ID 加载棋谱并分析 */
  async loadFromArchiveId(archiveId: string, taskId?: string, baseMoves?: Array<{ x: number; y: number; color: PlayerColor }>): Promise<boolean> {
    console.log('[ReviewAnalysis.loadFromArchiveId] 开始加载:', { archiveId, taskId });
    
    // 确保模型已加载（与 loadAndAnalyze 保持一致）
    await this.ensureModelLoaded(taskId);
    
    if (!this.gameService) {
      console.error('[ReviewAnalysis.loadFromArchiveId] GameService 未提供');
      return false;
    }
    try {
      const sgf = await this.gameService.getByArchiveId(archiveId);
      if (!sgf) throw new Error('棋谱不存在');
      this.currentArchiveId = archiveId;
      this.reviewId = await this.reviewApp.loadFromSGF(sgf);

      const hasSavedData = await this.loadSavedReviewData(archiveId);
      if (hasSavedData) {
        console.info('已恢复保存的复盘数据');
        if (taskId) {
          const detailUrl = `/assistant?taskId=${taskId}`;
          const reviewLink = `/review/index.html?view=favorite&key=${archiveId}`;
          const message = `已恢复保存的复盘数据\n\n[查看复盘结果](${reviewLink})`;
          TaskHelper.notifyComplete(taskId, '复盘完成', message, detailUrl);
        }
        return true;
      }
      await this.startAnalysis('deep', taskId, baseMoves);
      return true;
    } catch (error) {
      console.error('从归档加载棋谱失败', error as Error | undefined);
      this.callbacks.onStatusUpdate('加载失败');
      if (taskId) {
        TaskHelper.notifyFail(taskId, error instanceof Error ? error.message : '加载失败');
      }
      return false;
    }
  }

  /**
   * 确保模型已加载
   * @description 检查模型是否已初始化，如果未初始化或模型文件名不匹配则加载模型
   * @param taskId - 后台任务 ID（可选，用于通知后台进度）
   */
  private async ensureModelLoaded(taskId?: string): Promise<void> {
    // 获取保存的模型文件名
    const savedModelFileName = await this.modelManager?.loadModelFileName();
    
    // 获取当前已加载的模型文件名
    const currentModelFileName = this.aiController?.getModelFileName();
    
    // 检查是否需要加载模型（未初始化 或 模型文件名不一致）
    const needLoad = !this.aiController?.isInitialized() || 
                     (savedModelFileName && currentModelFileName !== savedModelFileName);
    
    if (needLoad) {
      if (!this.modelManager) {
        throw new Error('ModelManagementService not provided');
      }
      
      // 显示进度提示
      this.callbacks.onProgress(true);
      this.callbacks.onLoadingAnimation(true);
      this.callbacks.onUpdateLoadingText('正在加载模型...');
      this.callbacks.onUpdateProgress(0);
      
      // 通知后台开始加载模型
      if (taskId) {
        TaskHelper.notifyProgress(taskId, 0, '正在加载 AI 模型...');
      }
      
      try {
        // 加载模型
        const savedModelId = await this.modelManager.loadPreference();
        if (savedModelId) {
          let modelUrl: string | undefined;
          if (savedModelId === 'custom') {
            modelUrl = (await this.modelManager.loadCustomModelUrl()) ?? undefined;
          }
          
          await this.modelManager.switchModel(savedModelId, modelUrl, (loaded, total, progress) => {
            // 格式化进度，只显示整数
            const displayProgress = Math.round(progress);
            this.callbacks.onUpdateProgress(displayProgress);
            // 通知后台进度（模型下载）
            if (taskId) {
              TaskHelper.notifyProgress(taskId, displayProgress, `正在加载模型... ${displayProgress}%`);
            }
          }, (info) => {
            // KataGo 初始化进度（tuning）
            // 隐藏进度条，只显示文本
            this.callbacks.onProgress(false);
            
            let displayMessage = info.message || '';
            if (info.stage === 'tuning' && displayMessage.includes('Tuning')) {
              const match = displayMessage.match(/Tuning \d+\/\d+/);
              if (match) {
                displayMessage = match[0];
              }
            }
            this.callbacks.onUpdateLoadingText(displayMessage);
            // 通知后台进度（KataGo 初始化）
            // 根据初始化阶段计算进度：tuning 通常是最后阶段，进度在 80%-100% 之间
            if (taskId) {
              const initProgress = info.stage === 'tuning' ? 90 : 80;
              TaskHelper.notifyProgress(taskId, initProgress, displayMessage);
            }
          });
        } else {
          // 如果没有保存的模型，使用默认模型
          const models = await this.modelManager.getModels();
          const defaultModel = models.find(m => m.isDefault) || models[0];
          if (defaultModel) {
            await this.modelManager.switchModel(defaultModel.id, undefined, (loaded, total, progress) => {
              // 格式化进度，只显示整数
              const displayProgress = Math.round(progress);
              this.callbacks.onUpdateProgress(displayProgress);
              // 通知后台进度（模型下载）
              if (taskId) {
                TaskHelper.notifyProgress(taskId, displayProgress, `正在加载模型... ${displayProgress}%`);
              }
            }, (info) => {
              // KataGo 初始化进度（tuning）
              // 隐藏进度条，只显示文本
              this.callbacks.onProgress(false);
              
              let displayMessage = info.message || '';
              if (info.stage === 'tuning' && displayMessage.includes('Tuning')) {
                const match = displayMessage.match(/Tuning \d+\/\d+/);
                if (match) {
                  displayMessage = match[0];
                }
              }
              this.callbacks.onUpdateLoadingText(displayMessage);
              // 通知后台进度（KataGo 初始化）
              // 根据初始化阶段计算进度：tuning 通常是最后阶段，进度在 80%-100% 之间
              if (taskId) {
                const initProgress = info.stage === 'tuning' ? 90 : 80;
                TaskHelper.notifyProgress(taskId, initProgress, displayMessage);
              }
            });
          }
        }
        
        // 隐藏进度提示
        this.callbacks.onProgress(false);
        this.callbacks.onLoadingAnimation(false);
      } catch (error) {
        console.error('[ReviewAnalysis.ensureModelLoaded] 模型加载失败', error);
        this.callbacks.onProgress(false);
        this.callbacks.onLoadingAnimation(false);
        throw error;
      }
    }
  }

  /** 查看收藏的复盘结果 */
  async viewFavorite(archiveId: string): Promise<boolean> {
    try {
      // 确保模型已加载
      await this.ensureModelLoaded();
      
      // 加载棋谱
      const sgf = await this.gameService!.getByArchiveId(archiveId);
      if (!sgf) {
        console.warn('[ReviewAnalysis.viewFavorite] 棋谱不存在:', archiveId);
        return false;
      }
      
      this.reviewId = await this.reviewApp.loadFromSGF(sgf);
      const hasSavedData = await this.loadSavedReviewData(archiveId);
      
      if (hasSavedData) {
        this.callbacks.onStatusUpdate('已恢复复盘数据');
        return true;
      } else {
        console.warn('[ReviewAnalysis.viewFavorite] 复盘数据不存在:', archiveId);
        this.callbacks.onStatusUpdate('复盘数据不存在');
        return false;
      }
    } catch (error) {
      console.error('[ReviewAnalysis.viewFavorite] 加载收藏失败', error as Error | undefined);
      this.callbacks.onStatusUpdate('加载失败');
      return false;
    }
  }

  /** 加载棋谱并开始分析 */
  async loadAndAnalyze(sgf: string, baseMoves?: Array<{ x: number; y: number; color: PlayerColor }>): Promise<void> {
    try {
      // 确保模型已加载
      await this.ensureModelLoaded();
      
      // 加载棋谱
      this.reviewId = await this.reviewApp.loadFromSGF(sgf);
      const state = this.reviewApp.getState(this.reviewId);

      // 归档棋谱
      if (this.historyManager && state) {
        try {
          const favoriteId = await this.historyManager.saveToHistory(
            sgf,
            { moveHistory: baseMoves ?? [], board: { size: 19 } },
            { blackName: state.gameInfo.black, whiteName: state.gameInfo.white },
          );
          if (favoriteId) {
            const favorite = await this.favoriteService?.getById(favoriteId);
            if (favorite) {
              this.currentArchiveId = favorite.key;
            }
          }
        } catch (e) {
          console.warn('棋谱归档失败,继续分析', e as Error);
        }
      }

      await this.startAnalysis('deep', undefined, baseMoves);
      await this.saveReviewData();
    } catch (error) {
      console.error('加载棋谱失败', error as Error | undefined);
      this.callbacks.onStatusUpdate('加载失败');
    }
  }

  /** 获取胜率图分析用的 visits（根据模型大小） */
  /** 获取胜率图分析用的 visits（根据模型大小） */
  async getAnalysisVisits(): Promise<number> {
    let visits = 1;
    if (this.modelManager) {
      try {
        const modelId = await this.modelManager.loadPreference();
        const models = await this.modelManager.getModels();
        const model = models.find((m: any) => m.id === modelId);
        const blocks = (model as any)?.blocks ?? 0;
        if (blocks > 0) {
          if (blocks <= 6) visits = 50;
          else if (blocks <= 10) visits = 25;
          else visits = 1;
        } else if ((model as any)?.url) {
          const url = (model as any).url;
          if (typeof url === 'string') {
            const match = url.match(/b(\d+)c/i);
            if (match && match[1]) {
              const b = parseInt(match[1], 10);
              if (b <= 6) visits = 50;
              else if (b <= 10) visits = 25;
              else visits = 1;
            }
          }
        }
      } catch (e) {
        visits = 1;
      }
    }
    return visits;
  }

  /** 开始分析（胜率图描绘） */
  async startAnalysis(mode: 'quick' | 'deep' = 'quick', taskId?: string, baseMoves?: Array<{ x: number; y: number; color: PlayerColor }>): Promise<void> {
    if (!this.reviewId || this.analyzing) return;
    
    // 确保模型已加载（传递 taskId 用于后台进度通知）
    await this.ensureModelLoaded(taskId);
    
    this.analyzing = true;
    this.callbacks.onProgress(true);
    this.callbacks.onLoadingAnimation(true);
    this.callbacks.onUpdateLoadingText(`AI ${mode === 'deep' ? '深度' : '快速'}分析中...`);
    this.callbacks.onUpdateProgress(0);

    try {
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 胜率图描绘：根据模型自动选择 visits（固定值，不可配）
      // 小模型50，中模型25，大模型1
      let visits = 1;  // 默认值
      if (this.modelManager) {
        try {
          const modelId = await this.modelManager.loadPreference();
          const models = await this.modelManager.getModels();
          const model = models.find((m: any) => m.id === modelId);
          const blocks = (model as any)?.blocks ?? 0;
          if (blocks > 0) {
            if (blocks <= 6) visits = 50;
            else if (blocks <= 10) visits = 25;
            else visits = 1;
          } else if ((model as any)?.url) {
            // 从 URL 解析 blocks
            const url = (model as any).url;
            if (typeof url === 'string') {
              const match = url.match(/b(\d+)c/i);
              if (match && match[1]) {
                const b = parseInt(match[1], 10);
                if (b <= 6) visits = 50;
                else if (b <= 10) visits = 25;
                else visits = 1;
              }
            }
          }
        } catch (e) {
          console.warn('[ReviewAnalysis.startAnalysis] Failed to get model info, using default visits=1', e);
        }
      }

      // App 环境用批量分析（原生 KataGo 一次请求整盘），Web 用逐手分析
      const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
      const analyzeFn = isApp ? this.reviewApp.analyzeGameBatch : this.reviewApp.analyzeGameAsync;
      const result = await analyzeFn(
        this.reviewId,
        { visits, mode },
        {
          onProgress: (p) => {
            this.callbacks.onUpdateProgress(p.percentage);
            if (taskId) {
              TaskHelper.notifyProgress(taskId, p.percentage, `已分析 ${p.current || 0}/${p.total || 0} 手`);
            }
          },
          onMoveAnalyzed: (m) => this.callbacks.onMoveAnalyzed(m),
        },
      );

      const badMoves = this.reviewApp.getBadMoves(this.reviewId);
      const winrateTrend = this.reviewApp.getWinRateTrend(this.reviewId);
      const moves = result.moves.map(m => ({ x: m.x, y: m.y, color: m.color }));

      this.callbacks.onAnalysisComplete({ totalMoves: result.totalMoves, badMoves, winrateTrend, moves });

      await this.saveReviewData();
      if (taskId) {
        const detailUrl = `/assistant?taskId=${taskId}`;
        const reviewLink = `/review/index.html?view=favorite&key=${this.currentArchiveId}`;
        const message = `分析完成，共 ${result.totalMoves} 手\n\n[查看复盘结果](${reviewLink})`;
        TaskHelper.notifyComplete(taskId, '复盘完成', message, detailUrl);
      }
    } catch (error) {
      console.error('[ReviewAnalysis] 分析失败', error as Error | undefined);
      this.callbacks.onStatusUpdate('分析失败');
      if (taskId) {
        TaskHelper.notifyFail(taskId, error instanceof Error ? error.message : '分析失败');
      }
      throw error; // 重新抛出异常，让调用方知道分析失败
    } finally {
      this.analyzing = false;
      this.callbacks.onProgress(false);
      this.callbacks.onLoadingAnimation(false);
    }
  }

  /** 保存复盘数据到收藏服务 */
  async saveReviewData(winrateTrendOverride?: Array<{ moveNumber: number; winRate: number; scoreLead: number }>): Promise<void> {
    if (!this.currentArchiveId || !this.favoriteService || !this.reviewId) return;
    try {
      const state = this.reviewApp.getState(this.reviewId);
      if (!state) return;
      const badMoves = this.reviewApp.getBadMoves(this.reviewId);
      // 如果提供了 winrateTrend，使用提供的；否则从 reviewApp 获取
      const winrateTrend = winrateTrendOverride ?? this.reviewApp.getWinRateTrend(this.reviewId);
      const data = {
        blackName: state.gameInfo.black,
        whiteName: state.gameInfo.white,
        totalMoves: state.totalMoves,
        badMoves,
        winrateTrend,
        analyzedAt: Date.now(),
      };
      await this.favoriteService.addFavorite('review_data', this.currentArchiveId, data);
      console.info('[ReviewAnalysis] 复盘数据已保存，胜率数据:', winrateTrend.length, '手');
    } catch (error) {
      console.warn('[ReviewAnalysis] 保存复盘数据失败', error as Error);
    }
  }

  /** 加载已保存的复盘数据 */
  async loadSavedReviewData(archiveId: string): Promise<boolean> {
    if (!this.favoriteService) return false;
    try {
      const item = await this.favoriteService.getFavorite('review_data', archiveId);
      if (!item?.data) return false;
      const data = item.data as Record<string, unknown>;
      if (!data['badMoves'] || !data['winrateTrend']) return false;
      // 从 reviewApp 获取着法列表
      const moves = this.reviewId
        ? (this.reviewApp.getMoves(this.reviewId) ?? [])
        : [];
      this.callbacks.onAnalysisComplete({
        totalMoves: data['totalMoves'] as number,
        badMoves: (data['badMoves'] as BadMove[]) ?? [],
        winrateTrend: (data['winrateTrend'] as Array<{ moveNumber: number; winRate: number; scoreLead: number }>) ?? [],
        moves,
      });
      return true;
    } catch (error) {
      console.warn('[ReviewAnalysis] 加载保存的复盘数据失败', error as Error);
      return false;
    }
  }

  /** 销毁 */
  destroy(): void {
    if (this.reviewId) {
      this.reviewApp.destroy(this.reviewId);
    }
  }
}
