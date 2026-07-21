/**
 * @fileoverview 复盘应用编排器
 */
import type { IReviewService } from '../../services/review/IReviewService';
import type { IActivityLogService, ActivityEntry } from '../../services/activity';
import type { IAudioPlayer, SoundType } from '../../infrastructure/audio';
import type { IModelManagementService } from '../../services/model';
import type {
  ReviewOptions,
  ReviewCallbacks,
  ReviewState,
  SimpleReviewResult,
  FullReviewResult,
  MoveReview,
  BadMove,
} from '../../services/review/types';
import type { PlayerColor } from '../../domain/primitives';
/** 复盘历史查询选项 */
export interface ReviewHistoryOptions {
  keyword?: string;
  limit?: number;
  offset?: number;
}
/** 复盘历史条目 */
export interface ReviewHistoryEntry {
  id: string;
  reviewId: string;
  blackName: string;
  whiteName: string;
  totalMoves: number;
  badMoveCount: number;
  createdAt: number;
}
/** 复盘统计 */
export interface ReviewStats {
  total: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
}
interface ReviewActivityData extends Record<string, unknown> {
  reviewId: string;
  blackName: string;
  whiteName: string;
  totalMoves: number;
  badMoveCount: number;
  severeCount: number;
  moderateCount: number;
  minorCount: number;
}
/** 复盘应用编排器 */
export class ReviewApp {
  constructor(
    private readonly reviewService?: IReviewService,
    private readonly modelManager?: IModelManagementService,
    private readonly activityLogService?: IActivityLogService,
    private readonly audioPlayer?: IAudioPlayer,
  ) {}
  private requireReview(): IReviewService {
    if (!this.reviewService) throw new Error('ReviewService not provided');
    return this.reviewService;
  }
  private requireModel(): IModelManagementService {
    if (!this.modelManager) throw new Error('ModelManagementService not provided');
    return this.modelManager;
  }
  private requireActivity(): IActivityLogService {
    if (!this.activityLogService) throw new Error('ActivityLogService not provided');
    return this.activityLogService;
  }
  // ========== 模型管理（代理 ModelManagementService）==========
  /** 切换模型 */
  async switchModel(modelId: string, modelUrl?: string, onProgress?: (loaded: number, total: number, progress: number) => void): Promise<void> {
    return this.requireModel().switchModel(modelId, modelUrl, onProgress);
  }
  /** 获取当前模型 ID */
  getCurrentModel(): string | null {
    return this.requireModel().getCurrentModel();
  }
  /** 加载偏好 */
  async loadPreference(): Promise<string | null> {
    return this.requireModel().loadPreference();
  }
  // ========== 复盘操作（代理 ReviewService）==========
  loadFromSGF = (sgf: string): Promise<string> => this.requireReview().loadFromSGF(sgf);
  analyzeGame = (reviewId: string, options?: ReviewOptions): Promise<SimpleReviewResult> =>
    this.requireReview().analyzeGame(reviewId, options);
  analyzeGameAsync = (
    reviewId: string,
    options?: ReviewOptions,
    callbacks?: ReviewCallbacks,
  ): Promise<FullReviewResult> => this.requireReview().analyzeGameAsync(reviewId, options, callbacks);
  analyzeGameBatch = (
    reviewId: string,
    options?: ReviewOptions,
    callbacks?: ReviewCallbacks,
  ): Promise<FullReviewResult> => this.requireReview().analyzeGameBatch(reviewId, options, callbacks);
  analyzePosition = (reviewId: string, moveIndex: number, options?: ReviewOptions): Promise<MoveReview | null> =>
    this.requireReview().analyzePosition(reviewId, moveIndex, options);

  analyzeMoves = (moves: Array<{ x: number; y: number; color: PlayerColor }>, komi: number, options?: ReviewOptions, handicapStones?: Array<{ x: number; y: number; color: PlayerColor }>): Promise<MoveReview | null> =>
    this.requireReview().analyzeMoves(moves, komi, options, handicapStones);
  getBadMoves = (reviewId: string): BadMove[] => this.requireReview().getBadMoves(reviewId);
  getWinRateTrend = (reviewId: string): Array<{ moveNumber: number; winRate: number; scoreLead: number }> =>
    this.requireReview().getWinRateTrend(reviewId);
  getState = (reviewId: string): ReviewState | null => this.requireReview().getState(reviewId);
  getMoves = (reviewId: string): Array<{ x: number; y: number; color: PlayerColor }> | null => this.requireReview().getMoves(reviewId);
  appendMoves = (reviewId: string, moves: Array<{ x: number; y: number; color: PlayerColor }>): void => this.requireReview().appendMoves(reviewId, moves);
  destroy = (reviewId: string): void => this.requireReview().destroy(reviewId);
  // ========== 历史管理（使用 ActivityLogService）==========
  async saveToHistory(reviewId: string): Promise<string> {
    const review = this.requireReview();
    this.requireActivity();
    const state = review.getState(reviewId);
    if (!state) throw new Error(`Review ${reviewId} not found`);
    const badMoves = review.getBadMoves(reviewId);
    const data: ReviewActivityData = {
      reviewId,
      blackName: state.gameInfo.black,
      whiteName: state.gameInfo.white,
      totalMoves: state.totalMoves,
      badMoveCount: badMoves.length,
      severeCount: badMoves.filter((b) => b.severity === 'severe').length,
      moderateCount: badMoves.filter((b) => b.severity === 'moderate').length,
      minorCount: badMoves.filter((b) => b.severity === 'minor').length,
    };
    return this.activityLogService!.record(
      'review',
      `复盘：${state.gameInfo.black} vs ${state.gameInfo.white}`,
      data,
      ['复盘', '棋谱分析'],
    );
  }
  async queryHistory(options?: ReviewHistoryOptions): Promise<ReviewHistoryEntry[]> {
    if (!this.activityLogService) return [];
    const entries = await this.activityLogService.query({
      type: 'review',
      keyword: options?.keyword,
      limit: options?.limit ?? 20,
      offset: options?.offset,
    });
    return entries.map((e: ActivityEntry) => ({
      id: e.id,
      reviewId: (e.data['reviewId'] as string) ?? '',
      blackName: (e.data['blackName'] as string) ?? '',
      whiteName: (e.data['whiteName'] as string) ?? '',
      totalMoves: (e.data['totalMoves'] as number) ?? 0,
      badMoveCount: (e.data['badMoveCount'] as number) ?? 0,
      createdAt: e.createdAt,
    }));
  }
  getHistoryDetail = (id: string): Promise<ActivityEntry | null> =>
    this.activityLogService ? this.activityLogService.getById(id) : Promise.resolve(null);
  clearHistory = (): Promise<void> => this.requireActivity().clear('review');
  async getStats(): Promise<ReviewStats> {
    if (!this.activityLogService) return { total: 0, today: 0, thisWeek: 0, thisMonth: 0 };
    const stats = await this.activityLogService.stats();
    return {
      total: stats.byType['review'] ?? 0,
      today: stats.today,
      thisWeek: stats.thisWeek,
      thisMonth: stats.thisMonth,
    };
  }
  // ========== 音效管理 ==========
  /**
   * 播放音效
   */
  playSound(type: SoundType): void {
    if (!this.audioPlayer) return;
    this.audioPlayer.play(type).catch(() => {
      // 音效播放失败，静默处理
    });
  }
  /**
   * 初始化音频（需要在用户手势中调用）
   */
  async initializeAudio(): Promise<void> {
    if (!this.audioPlayer) return;
    if ('initialize' in this.audioPlayer) {
      await (this.audioPlayer as any).initialize();
    }
  }
}
