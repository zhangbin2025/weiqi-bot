/**
 * @fileoverview 复盘服务接口定义
 */

import type {
  ReviewOptions,
  ReviewCallbacks,
  ReviewState,
  SimpleReviewResult,
  FullReviewResult,
  MoveReview,
  BadMove,
} from './types';
import type { PlayerColor } from '../../domain/primitives';

/**
 * 复盘服务接口
 *
 * 提供棋谱分析、恶手检测、趋势分析等能力
 */
export interface IReviewService {
  /**
   * 从 SGF 创建复盘
   * @param sgf - SGF 格式棋谱
   * @returns 复盘 ID
   */
  loadFromSGF(sgf: string): Promise<string>;

  /**
   * 分析整盘棋谱（简单格式）
   * @param reviewId - 复盘 ID
   * @param options - 分析选项
   */
  analyzeGame(reviewId: string, options?: ReviewOptions): Promise<SimpleReviewResult>;

  /**
   * 分析整盘棋谱（完整格式，带进度回调）
   * @param reviewId - 复盘 ID
   * @param options - 分析选项
   * @param callbacks - 回调函数
   */
  analyzeGameAsync(
    reviewId: string,
    options?: ReviewOptions,
    callbacks?: ReviewCallbacks
  ): Promise<FullReviewResult>;

  /**
   * 批量分析整盘棋（App 原生优化路径）
   *
   * 利用 KataGo analyzeGame 一次请求分析整盘棋，性能远超逐手串行。
   * 如果引擎不支持 analyzeGame（Web 端），fallback 到逐手分析。
   *
   * @param reviewId 复盘 ID
   * @param options 分析选项
   * @param callbacks 回调
   */
  analyzeGameBatch(
    reviewId: string,
    options?: ReviewOptions,
    callbacks?: ReviewCallbacks
  ): Promise<FullReviewResult>;

  /**
   * 分析单个局面
   * @param reviewId - 复盘 ID
   * @param moveIndex - 着法索引（从 0 开始）
   * @param options - 分析选项
   */
  analyzePosition(
    reviewId: string,
    moveIndex: number,
    options?: ReviewOptions
  ): Promise<MoveReview | null>;

  /**
   * 分析任意着法列表的局面（用于试下模式）
   * @param moves - 完整着法列表
   * @param komi - 贴目
   * @param options - 分析选项
   * @param handicapStones - 让子棋（可选）
   */
  analyzeMoves(
    moves: Array<{ x: number; y: number; color: PlayerColor }>,
    komi: number,
    options?: ReviewOptions,
    handicapStones?: Array<{ x: number; y: number; color: PlayerColor }>
  ): Promise<MoveReview | null>;

  /**
   * 获取恶手列表
   * @param reviewId - 复盘 ID
   */
  getBadMoves(reviewId: string): BadMove[];

  /**
   * 获取胜率趋势
   * @param reviewId - 复盘 ID
   * @returns 每手棋的胜率和目差
   */
  getWinRateTrend(
    reviewId: string
  ): Array<{ moveNumber: number; winRate: number; scoreLead: number }>;

  /**
   * 获取复盘状态
   * @param reviewId - 复盘 ID
   */
  getState(reviewId: string): ReviewState | null;

  /**
   * 获取复盘棋谱的 moves
   * @param reviewId - 复盘 ID
   */
  getMoves(reviewId: string): Array<{ x: number; y: number; color: PlayerColor }> | null;

  /**
   * 销毁复盘
   * @param reviewId - 复盘 ID
   */
  appendMoves(reviewId: string, moves: Array<{ x: number; y: number; color: PlayerColor }>): void;
  destroy(reviewId: string): void;
}