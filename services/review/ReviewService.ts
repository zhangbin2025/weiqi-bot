/**
 * @fileoverview 复盘服务
 */
import type { IAIController } from '../ai/IAIController';
import type { IAIEngine } from '../../infrastructure/ai/IAIEngine';
import type { PlayerColor, BoardState } from '../../domain';
import type { SGFParser } from '../../domain/sgf/SGFParser';
import { sgfColorToPlayerColor, playerColorToSGFColor } from '../../domain/primitives';
import { classifyBadMove } from '../../domain/decision';
import { Game } from '../../domain/game';
import { KataGoQueryBuilder } from '../../infrastructure/katago/KataGoQueryBuilder';
import type { ReviewOptions, ReviewCallbacks, ReviewState, SimpleReviewResult, FullReviewResult, MoveReview, BadMove } from './types';
import type { IReviewService } from './IReviewService';
import { BadMoveDetector } from './BadMoveDetector';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { IReviewConfig } from '../../infrastructure/config/schemas/ReviewConfigSchema';

interface ReviewData {
  id: string;
  moves: Array<{ x: number; y: number; color: PlayerColor }>;
  handicapStones: Array<{ x: number; y: number; color: PlayerColor }>;
  komi: number;
  gameInfo: ReviewState['gameInfo'];
  result: FullReviewResult | null;
  analyzing: boolean;
  progress: number;
}

export class ReviewService implements IReviewService {
  private reviews = new Map<string, ReviewData>();
  private ai: IAIController | null;
  private sgfParser: SGFParser | null;
  private detector: BadMoveDetector;
  private config: IReviewConfig | null = null;
  private configProvider: IConfigProvider | null = null;

  constructor(ai?: IAIController, sgfParser?: SGFParser, configProvider?: IConfigProvider) {
    this.ai = ai ?? null;
    this.sgfParser = sgfParser ?? null;
    this.configProvider = configProvider ?? null;
    this.detector = new BadMoveDetector();
  }

  private async getConfig(): Promise<IReviewConfig> {
    if (!this.config) {
      if (!this.configProvider) {
        this.config = {
          defaultVisits: 0,  // 默认使用 Quick 模式（批量评估）
          defaultTopK: 5,
          defaultMode: 'deep',
          defaultKomi: 7.5,
          analyzeTimeout: 30000,
        };
      } else {
        this.config = await this.configProvider.getModuleConfig<IReviewConfig>('review');
      }
    }
    return this.config;
  }

  async loadFromSGF(sgf: string): Promise<string> {
    if (!this.sgfParser) throw new Error('SGFParser not provided');
    const parsed = this.sgfParser.parse(sgf);
    const info = parsed.gameInfo;
    const id = `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // 转换着法列表，处理 Pass 着法
    const moves = parsed.moves.map((m) => {
      // 空字符串表示 Pass 着法
      if (!m.coord || m.coord.length < 2) {
        return { x: -1, y: -1, color: sgfColorToPlayerColor(m.color as 'B' | 'W') };
      }
      return {
        x: m.coord.charCodeAt(0) - 97,
        y: m.coord.charCodeAt(1) - 97,
        color: sgfColorToPlayerColor(m.color as 'B' | 'W'),
      };
    });
    
    // 转换让子棋的初始棋子
    const handicapStones = (info.handicapStones || []).map((h) => ({
      x: h.x,
      y: h.y,
      color: sgfColorToPlayerColor(h.color as 'B' | 'W'),
    }));
    
    // 解析贴目（处理异常大的值）
    // 注意：parseFloat("0") = 0，不能用 || 判断，因为 0 || 7.5 = 7.5
    const parsedKomi = parseFloat(info.komi);
    let komi = Number.isNaN(parsedKomi) ? 7.5 : parsedKomi;
    
    // 如果贴目值异常大（> 50），说明是毫单位，需要除以100
    // 例如：KM[375] 表示 3.75子
    if (komi > 50) {
      komi = komi / 100;
    }
    
    // 如果贴目值 < 5 且 > 0，很可能是"子"单位，需要转换为"目"单位
    // 围棋规则：1 子 = 2 目
    // 例如：3.75子 = 7.5目（中国规则标准贴目）
    // 注意：KM[0] 是让子棋，不需要转换
    // 标准贴目值（目）：7.5, 6.5, 7.0, 5.5, 0（让子棋）
    if (komi < 5 && komi > 0) {
      komi = komi * 2;  // 子 -> 目
    }
    
    // 确保 komi 是半整数或整数（符合 KataGo 要求）
    // KataGo 要求 komi 必须是整数或半整数（如 7.0, 7.5, 6.5）
    if (komi % 0.5 !== 0) {
      komi = Math.round(komi * 2) / 2;  // round 到半整数
    }
    
    const gameInfo: ReviewState['gameInfo'] = { black: info.black, white: info.white, komi };
    if (info.result) gameInfo.result = info.result;
    this.reviews.set(id, { id, moves, handicapStones, komi, gameInfo, result: null, analyzing: false, progress: 0 });
    return id;
  }

  async analyzeGame(reviewId: string, options?: ReviewOptions): Promise<SimpleReviewResult> {
    const full = await this.analyzeGameAsync(reviewId, options);
    return { totalMoves: full.totalMoves, moves: full.moves.map(({ moveNumber, x, y, color, winRate, scoreLead }) => ({ moveNumber, x, y, color, winRate, scoreLead })) };
  }

  async analyzeGameAsync(reviewId: string, options?: ReviewOptions, callbacks?: ReviewCallbacks): Promise<FullReviewResult> {
    const data = this.getReview(reviewId);
    this.ensureAI();
    const config = await this.getConfig();
    const { visits, topK, mode, includePv } = {
      visits: config.defaultVisits,
      topK: config.defaultTopK,
      mode: config.defaultMode,
      includePv: false,  // 默认不获取PV，提高速度
      ...options,
    };
    const komi = options?.komi ?? data.komi ?? config.defaultKomi;
    const startTime = Date.now();

    // 如果 visits === 0，使用 Quick 模式（批量评估）
    if (visits === 0) {
      return this.analyzeGameQuick(data, callbacks);
    }

    // 否则使用 MCTS 分析
    const moveReviews: MoveReview[] = [];
    data.analyzing = true;

    try {
      for (let i = 0; i < data.moves.length; i++) {
        callbacks?.onProgress?.({ current: i, total: data.moves.length, percentage: Math.round((i / data.moves.length) * 100) });
        const review = await this.analyzeMoveAt(data, i, komi, visits, topK, moveReviews, includePv);
        moveReviews.push(review);
        callbacks?.onMoveAnalyzed?.(review);
        data.progress = (i + 1) / data.moves.length;
      }
      const result: FullReviewResult = { totalMoves: data.moves.length, moves: moveReviews, analysis: { mode, visits, analysisTime: (Date.now() - startTime) / 1000 } };
      data.result = result;
      return result;
    } finally { data.analyzing = false; }
  }

  async analyzePosition(reviewId: string, moveIndex: number, options?: ReviewOptions): Promise<MoveReview | null> {
    const data = this.getReview(reviewId);
    this.ensureAI();
    if (moveIndex < 0) return null;
    
    const config = await this.getConfig();
    const visits = options?.visits ?? config.defaultVisits;
    const topK = options?.topK ?? config.defaultTopK;
    const komi = options?.komi ?? data.komi ?? config.defaultKomi;
    const includePv = options?.includePv ?? true;  // 局面分析默认获取PV
    
    // 如果是最后一着之后（moveIndex >= data.moves.length），分析当前局面的下一步
    if (moveIndex >= data.moves.length) {
      return this.analyzeNextMove(data, komi, visits, topK, includePv);
    }
    
    return this.analyzeMoveAt(data, moveIndex, komi, visits, topK, [], includePv);
  }

  /**
   * 分析最后一着之后的局面（当前局面下下一步应该怎么下）
   */
  private async analyzeNextMove(data: ReviewData, komi: number, visits: number, topK: number, includePv: boolean): Promise<MoveReview> {
    // 重建当前棋盘状态（所有着法都已下）
    const board = this.rebuildBoard(data.handicapStones, data.moves.slice(0, data.moves.length));
    const moveHistory = data.moves.map((m) => ({ x: m.x, y: m.y, player: m.color }));
    
    // 确定当前玩家（最后一手之后轮到谁）
    const lastMove = data.moves[data.moves.length - 1];
    const currentPlayer: PlayerColor = lastMove?.color === 'black' ? 'white' : 'black';
    
    // 重建前一手的棋盘状态
    const previousBoard = data.moves.length > 0 ? this.rebuildBoard(data.handicapStones, data.moves.slice(0, data.moves.length - 1)) : null;
    
    // 转换让子棋格式：{ x, y, color } -> { player, x, y }
    const initialStones = data.handicapStones.map(s => ({
      player: s.color,
      x: s.x,
      y: s.y,
    }));
    
    const analysis = await this.ai!.analyze(board, previousBoard, currentPlayer, moveHistory, komi, visits, undefined, includePv ? 15 : 0, initialStones);
    
    // 返回结果（没有胜率变化，因为没有实际着法可以比较）
    return {
      moveNumber: data.moves.length + 1,  // 下一步的手数
      x: -1,  // 没有实际着法
      y: -1,
      color: currentPlayer,
      winRate: analysis.winRate,
      scoreLead: analysis.scoreLead,
      winRateChange: 0,  // 没有胜率变化
      isBadMove: false,
      candidates: analysis.topMoves.slice(0, topK).map((m) => ({
        x: m.x,
        y: m.y,
        winRate: m.winRate,
        scoreLead: m.scoreLead,
        visits: m.visits,
        ...(m.pv ? { pv: m.pv } : {}),
      })),
    };
  }

  /**
   * 批量分析整盘棋（App 原生优化路径）
   *
   * 利用 KataGo analyzeGame 一次请求分析整盘棋，性能远超逐手串行。
   * 如果引擎不支持 analyzeGame（Web 端），fallback 到逐手分析。
   *
   * @param reviewId 复盘 ID
   * @param options 分析选项
   * @param callbacks 回调
   * @returns 完整复盘结果
   */
  async analyzeGameBatch(reviewId: string, options?: ReviewOptions, callbacks?: ReviewCallbacks): Promise<FullReviewResult> {
    const data = this.getReview(reviewId);
    this.ensureAI();
    const config = await this.getConfig();
    const visits = options?.visits ?? config.defaultVisits;
    const topK = options?.topK ?? config.defaultTopK;
    const komi = options?.komi ?? data.komi ?? config.defaultKomi;
    const includePv = options?.includePv ?? false;
    const startTime = Date.now();

    // 检查底层引擎是否支持 analyzeGame（App 原生）
    // 不能检查 AIController，因为 AIController 总是有 analyzeGame 方法
    // 需要检查底层 IAIEngine
    const engine = (this.ai as any)?.engine as IAIEngine | undefined;
    if (!engine?.analyzeGame) {
      // Fallback: 逐手分析
      return this.analyzeGameAsync(reviewId, options, callbacks);
    }

    data.analyzing = true;

    try {
      // 构造着法列表（AIController.analyzeGame 格式）
      const moves = data.moves.map(m => ({
        player: m.color as PlayerColor,
        x: m.x,
        y: m.y,
      }));

      // 分析所有回合
      const analyzeTurns = Array.from({ length: data.moves.length }, (_, i) => i);

      callbacks?.onProgress?.({ current: 0, total: data.moves.length, percentage: 0 });

      // 定义进度回调
      const onResultProgress = (current: number, total: number) => {
        callbacks?.onProgress?.({
          current,
          total,
          percentage: Math.round((current / total) * 100)
        });
      };
      
      // 转换让子棋格式：{ x, y, color } -> { player, x, y }
      const initialStones = data.handicapStones.map(s => ({
        player: s.color,
        x: s.x,
        y: s.y,
      }));
      
      const results = await (this.ai as any).analyzeGame(moves, komi, {
        visits: visits > 0 ? visits : 25,
        analyzeTurns,
        includeOwnership: true,
        includePv,
        onResultProgress,
        initialStones,  // 让子棋的初始棋子
      });

      // 转换为 MoveReview[]
      const moveReviews = this.convertBatchResults(data, results, topK);

      // 回调通知
      for (const review of moveReviews) {
        callbacks?.onMoveAnalyzed?.(review);
      }

      callbacks?.onProgress?.({ current: data.moves.length, total: data.moves.length, percentage: 100 });

      const result: FullReviewResult = {
        totalMoves: data.moves.length,
        moves: moveReviews,
        analysis: {
          mode: visits > 0 ? 'deep' : 'quick',
          visits: visits,
          analysisTime: (Date.now() - startTime) / 1000,
        },
      };
      data.result = result;
      return result;
    } finally {
      data.analyzing = false;
    }
  }

  /**
   * 将 KataGo analyzeGame 批量结果转换为 MoveReview[]
   */
  private convertBatchResults(
    data: ReviewData,
    turns: Array<{
      turnNumber: number;
      winRate: number;
      scoreLead: number;
      visits: number;
      topMoves: Array<{
        move: string;
        winRate: number;
        scoreLead: number;
        visits: number;
        prior: number;
        pv: string[];
      }>;
      ownership?: number[];
    }>,
    topK: number,
  ): MoveReview[] {
    const moveReviews: MoveReview[] = [];

    for (let i = 0; i < data.moves.length && i < turns.length; i++) {
      const move = data.moves[i]!;
      const turn = turns[i]!;

      // 计算胜率变化
      let winRateChange = 0;
      if (i > 0 && moveReviews.length > 0) {
        const prevWinRate = moveReviews[i - 1]!.winRate;
        const delta = turn.winRate - prevWinRate;
        // 转为当前方视角
        winRateChange = move.color === 'black' ? delta : -delta;
      }

      // 恶手检测
      const bestMove = turn.topMoves[0];
      if (bestMove) {
        const bestWinRate = move.color === 'black' ? bestMove.winRate : 1 - bestMove.winRate;
        const currentWinRate = move.color === 'black' ? turn.winRate : 1 - turn.winRate;
        winRateChange = currentWinRate - bestWinRate;
      }

      const isBadMove = this.detector.isBadMove(winRateChange);
      const severity = isBadMove ? classifyBadMove(Math.abs(winRateChange) * 100) : undefined;

      // GTP 坐标转 {x, y}
      const review: MoveReview = {
        moveNumber: i + 1,
        x: move.x,
        y: move.y,
        color: move.color,
        winRate: turn.winRate,
        scoreLead: turn.scoreLead,
        winRateChange,
        isBadMove,
        candidates: turn.topMoves.slice(0, topK).map(tm => {
          const coord = KataGoQueryBuilder.gtpToMove(tm.move);
          return {
            x: coord.x,
            y: coord.y,
            winRate: tm.winRate,
            scoreLead: tm.scoreLead,
            visits: tm.visits,
            ...(tm.pv.length > 0 ? { pv: tm.pv } : {}),
          };
        }),
      };

      if (bestMove) {
        const bestCoord = KataGoQueryBuilder.gtpToMove(bestMove.move);
        review.betterMove = { x: bestCoord.x, y: bestCoord.y, winRate: bestMove.winRate, scoreLead: bestMove.scoreLead };
      }

      if (severity) review.badMoveSeverity = severity;
      moveReviews.push(review);
    }

    return moveReviews;
  }

  /**
   * 分析任意着法列表的局面（用于试下模式）
   * @param moves - 完整着法列表（棋谱 + 试下着法）
   * @param komi - 贴目
   * @param options - 分析选项
   * @param handicapStones - 让子棋（可选）
   */
  async analyzeMoves(
    moves: Array<{ x: number; y: number; color: PlayerColor }>,
    komi: number,
    options?: ReviewOptions,
    handicapStones?: Array<{ x: number; y: number; color: PlayerColor }>
  ): Promise<MoveReview | null> {
    this.ensureAI();
    if (moves.length === 0) return null;
    
    const config = await this.getConfig();
    const visits = options?.visits ?? config.defaultVisits;
    const topK = options?.topK ?? config.defaultTopK;
    const includePv = options?.includePv ?? true;
    
    // 重建当前棋盘状态（所有着法都已下）
    // 使用传入的让子棋，如果没有则使用空数组
    const stones = handicapStones ?? [];
    const board = this.rebuildBoard(stones, moves);
    const moveHistory = moves.map((m) => ({ x: m.x, y: m.y, player: m.color }));
    
    // 确定当前玩家（最后一手的对手）
    const lastMove = moves[moves.length - 1]!;  // 已检查 moves.length > 0
    const currentPlayer: PlayerColor = lastMove.color === 'black' ? 'white' : 'black';
    
    // 重建前一手的棋盘状态
    const previousBoard = moves.length > 0 ? this.rebuildBoard(stones, moves.slice(0, moves.length - 1)) : null;
    
    // 转换让子棋格式：{ x, y, color } -> { player, x, y }
    const initialStones = stones.map(s => ({
      player: s.color,
      x: s.x,
      y: s.y,
    }));
    
    const analysis = await this.ai!.analyze(board, previousBoard, currentPlayer, moveHistory, komi, visits, undefined, includePv ? 15 : 0, initialStones);
    
    // 返回结果
    return {
      moveNumber: moves.length + 1,  // 下一步的手数
      x: -1,  // 没有实际着法
      y: -1,
      color: currentPlayer,
      winRate: analysis.winRate,
      scoreLead: analysis.scoreLead,
      winRateChange: 0,  // 没有胜率变化
      isBadMove: false,
      candidates: analysis.topMoves.slice(0, topK).map((m) => ({
        x: m.x,
        y: m.y,
        winRate: m.winRate,
        scoreLead: m.scoreLead,
        visits: m.visits,
        ...(m.pv ? { pv: m.pv } : {}),
      })),
    };
  }

  getBadMoves(reviewId: string): BadMove[] {
    const data = this.getReview(reviewId);
    return data.result ? this.detector.detect(data.result) : [];
  }

  getWinRateTrend(reviewId: string): Array<{ moveNumber: number; winRate: number; scoreLead: number }> {
    const data = this.getReview(reviewId);
    return data.result?.moves.map(({ moveNumber, winRate, scoreLead }) => ({ moveNumber, winRate, scoreLead })) ?? [];
  }

  getState(reviewId: string): ReviewState | null {
    const data = this.reviews.get(reviewId);
    return data ? { 
      id: data.id, 
      gameInfo: data.gameInfo, 
      handicapStones: data.handicapStones,
      totalMoves: data.moves.length, 
      analyzing: data.analyzing, 
      progress: data.progress 
    } : null;
  }

  getMoves(reviewId: string): Array<{ x: number; y: number; color: PlayerColor }> | null {
    const data = this.reviews.get(reviewId);
    return data ? data.moves : null;
  }

  destroy(reviewId: string): void { this.reviews.delete(reviewId); }

  /**
   * Quick 模式：批量评估（不使用MCTS，速度快但准确性低）
   * 优化：分批处理，避免内存泄漏
   */
  private async analyzeGameQuick(data: ReviewData, callbacks?: ReviewCallbacks): Promise<FullReviewResult> {
    const startTime = Date.now();
    const komi = data.komi ?? 7.5;
    data.analyzing = true;

    try {
      const moveReviews: MoveReview[] = [];
      const BATCH_SIZE = 10;  // 每批处理 10 个位置，避免内存峰值

      // 分批处理
      for (let batchStart = 0; batchStart < data.moves.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, data.moves.length);
        
        // 收集当前位置批次
        const positions = [];
        for (let i = batchStart; i < batchEnd; i++) {
          const board = this.rebuildBoard(data.handicapStones, data.moves.slice(0, i));
          const previousBoard = i > 0 ? this.rebuildBoard(data.handicapStones, data.moves.slice(0, i - 1)) : null;
          const move = data.moves[i]!;
          positions.push({
            board,
            previousBoard,
            currentPlayer: move.color,
            moveHistory: data.moves.slice(0, i).map(m => ({ x: m.x, y: m.y, player: m.color })),
            komi,
          });
        }

        // 批量评估
        callbacks?.onProgress?.({
          current: batchStart,
          total: data.moves.length,
          percentage: Math.round((batchStart / data.moves.length) * 100),
        });
        const evals = await this.ai!.evaluateBatch(positions);

        // 转换为 MoveReview
        for (let i = 0; i < evals.length; i++) {
          const moveIndex = batchStart + i;
          const move = data.moves[moveIndex]!;
          const evalResult = evals[i]!;
          
          // Quick 模式恶手判断（近似）：
          // 没有AI一选信息，用相邻两手的胜率变化来近似
          // 关键：需要转换为当前落子方的视角
          // evalResult.winRate 是黑方视角，黑方下后胜率应上升，白方下后胜率应下降
          // 恶手 = 当前方下了一步差棋，导致自己的胜率下降
          let winRateChange = 0;
          if (moveIndex > 0 && moveReviews.length > 0) {
            const prevWinRate = moveReviews[moveReviews.length - 1]!.winRate;
            const delta = evalResult.winRate - prevWinRate;
            // 转为当前方视角：黑方胜率上升=黑好，白方胜率下降=白好
            // 恶手时 winRateChange 应为负值
            winRateChange = move.color === 'black' ? delta : -delta;
          }
          
          const isBadMove = this.detector.isBadMove(winRateChange);
          const severity = isBadMove ? classifyBadMove(Math.abs(winRateChange) * 100) : undefined;
          
          const moveReview: MoveReview = {
            moveNumber: moveIndex + 1,
            x: move.x,
            y: move.y,
            color: move.color,
            winRate: evalResult.winRate,
            scoreLead: evalResult.scoreLead,
            winRateChange,
            isBadMove,
            ...(severity ? { badMoveSeverity: severity } : {}),
            candidates: [],
          };
          
          moveReviews.push(moveReview);
          callbacks?.onMoveAnalyzed?.(moveReview);
        }

        // 显式清理 positions 数组，帮助 GC
        positions.length = 0;
      }

      callbacks?.onProgress?.({
        current: data.moves.length,
        total: data.moves.length,
        percentage: 100,
      });

      const result: FullReviewResult = {
        totalMoves: data.moves.length,
        moves: moveReviews,
        analysis: { mode: 'quick', visits: 0, analysisTime: (Date.now() - startTime) / 1000 },
      };
      data.result = result;
      return result;
    } finally {
      data.analyzing = false;
    }
  }

  private async analyzeMoveAt(data: ReviewData, index: number, komi: number, visits: number, topK: number, prev: MoveReview[], includePv = false): Promise<MoveReview> {
    const move = data.moves[index]!;
    const moveHistory = data.moves.slice(0, index).map((m) => ({ x: m.x, y: m.y, player: m.color }));
    
    // 重建当前棋盘状态（落子前的局面）
    const board = this.rebuildBoard(data.handicapStones, data.moves.slice(0, index));
    
    // 重建前一手的棋盘状态
    const previousBoard = index > 0 ? this.rebuildBoard(data.handicapStones, data.moves.slice(0, index - 1)) : null;
    
    // 转换让子棋格式：{ x, y, color } -> { player, x, y }
    const initialStones = data.handicapStones.map(s => ({
      player: s.color,
      x: s.x,
      y: s.y,
    }));
    
    let analysis;
    try {
      analysis = await this.ai!.analyze(board, previousBoard, move.color, moveHistory, komi, visits, undefined, includePv ? 15 : 0, initialStones);
    } catch (error) {
      console.error(`[ReviewService] KataGo 分析失败 (第${index + 1}手):`, error);
      throw error;
    }

    let winRateChange = 0;
    
    // 正确的恶手判断：比较AI推荐的胜率 vs 玩家实际着法后的胜率
    // 而不是比较相邻两手的胜率变化
    
    // AI推荐的第一个选点的胜率（最优选点）
    const bestMove = analysis.topMoves[0];
    
    if (bestMove) {
      // AI推荐选点的胜率（当前玩家视角）
      const bestWinRate = move.color === 'black' ? bestMove.winRate : 1 - bestMove.winRate;
      
      // 当前局面的胜率（玩家实际下完这手后的胜率）
      const currentWinRate = move.color === 'black' ? analysis.winRate : 1 - analysis.winRate;
      
      // 胜率损失 = AI推荐胜率 - 实际胜率
      winRateChange = currentWinRate - bestWinRate;
    }

    const isBadMove = this.detector.isBadMove(winRateChange);
    const severity = isBadMove ? classifyBadMove(Math.abs(winRateChange) * 100) : undefined;
    const better = analysis.topMoves[0];

    const result: MoveReview = {
      moveNumber: index + 1, x: move.x, y: move.y, color: move.color,
      winRate: analysis.winRate, scoreLead: analysis.scoreLead, winRateChange,
      isBadMove,
      candidates: analysis.topMoves.slice(0, topK).map((m) => ({ 
        x: m.x, 
        y: m.y, 
        winRate: m.winRate, 
        scoreLead: m.scoreLead, 
        visits: m.visits,
        ...(m.pv ? { pv: m.pv } : {}),  // 保留 PV line
      })),
    };
    if (better) {
      result.betterMove = { x: better.x, y: better.y, winRate: better.winRate, scoreLead: better.scoreLead };
    }
    if (severity) result.badMoveSeverity = severity;
    return result;
  }
  
  /**
   * 重建棋盘状态（使用 Game 类确保正确处理提子）
   * @param handicapStones - 让子棋的初始棋子
   * @param moves - 从开始到当前的所有着法
   * @returns 当前棋盘状态
   */
  private rebuildBoard(
    handicapStones: Array<{ x: number; y: number; color: PlayerColor }>,
    moves: Array<{ x: number; y: number; color: PlayerColor }>
  ): BoardState {
    // 使用 Game 类来正确处理围棋规则（包括提子）
    const game = new Game();
    game.newGame({ size: 19 });
    
    // 首先添加让子棋的初始棋子（使用 setHandicapStones 确保正确处理）
    if (handicapStones.length > 0) {
      // 转换颜色格式：PlayerColor ('black' | 'white') -> SGFColor ('B' | 'W')
      const sgfHandicapStones = handicapStones.map(s => ({
        x: s.x,
        y: s.y,
        color: playerColorToSGFColor(s.color),
      }));
      game.setHandicapStones(sgfHandicapStones);
    }
    
    // 依次落子，检查关键位置（例如第200手要下在 (10, 14)）
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i]!;
      const isPass = move.x < 0 || move.y < 0;
      
      if (isPass) {
        game.pass();
        continue;
      }
      
      if (move.x >= 0 && move.x < 19 && move.y >= 0 && move.y < 19) {
        const beforeState = game.getBoard().getPoint(move.x, move.y);
        const result = game.placeStone(move.x, move.y);
        
        if (!result.success) {
          console.error(`[rebuildBoard] 第${i + 1}手失败: (${move.x}, ${move.y}) ${move.color}`);
          console.error(`  错误: ${result.error}`);
          console.error(`  原因可能是: 着法历史错误或棋盘状态不一致`);
        }
      }
    }
    
    // 获取棋盘状态
    return game.getBoard().getState() as BoardState;
  }

  private getReview(id: string): ReviewData {
    const data = this.reviews.get(id);
    if (!data) throw new Error(`Review not found: ${id}`);
    return data;
  }

  private ensureAI(): void { if (!this.ai) throw new Error('AIController not provided'); }
}
