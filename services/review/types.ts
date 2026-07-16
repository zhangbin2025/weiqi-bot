/**
 * @fileoverview 复盘服务类型定义
 */

import type { PlayerColor } from '../../domain';

/** 复盘选项 */
export interface ReviewOptions {
  /** AI 分析访问次数，默认 100 */
  visits?: number;
  /** 返回候选着法数量，默认 5 */
  topK?: number;
  /** 贴目，默认从棋谱读取 */
  komi?: number;
  /** 分析模式 */
  mode?: 'quick' | 'deep';
  /** 是否包含PV line（后续变化），默认false（不包含，速度更快） */
  includePv?: boolean;
}

/** 复盘回调 */
export interface ReviewCallbacks {
  /** 进度回调 */
  onProgress?: (progress: ReviewProgress) => void;
  /** 单手棋分析完成回调 */
  onMoveAnalyzed?: (move: MoveReview) => void;
}

/** 复盘进度 */
export interface ReviewProgress {
  /** 当前已分析手数 */
  current: number;
  /** 总手数 */
  total: number;
  /** 完成百分比 */
  percentage: number;
}

/** 单手棋分析结果 */
export interface MoveReview {
  /** 手数（从 1 开始） */
  moveNumber: number;
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
  /** 执棋方 */
  color: PlayerColor;
  /** 胜率（当前方视角，0-1） */
  winRate: number;
  /** 目差 */
  scoreLead: number;
  /** 胜率变化（相对于上一手，负数表示下降） */
  winRateChange: number;
  /** 是否恶手 */
  isBadMove: boolean;
  /** 恶手严重程度 */
  badMoveSeverity?: 'minor' | 'moderate' | 'severe';
  /** 更好的着法 */
  betterMove?: { x: number; y: number; winRate: number; scoreLead: number };
  /** 候选着法列表 */
  candidates?: Array<{
    x: number;
    y: number;
    winRate: number;
    scoreLead: number;
    visits: number;
    pv?: string[];  // PV line（后续变化）
  }>;
}

/** 简单复盘结果 */
export interface SimpleReviewResult {
  /** 总手数 */
  totalMoves: number;
  /** 每手棋分析结果 */
  moves: Array<{
    moveNumber: number;
    x: number;
    y: number;
    color: PlayerColor;
    winRate: number;
    scoreLead: number;
  }>;
}

/** 完整复盘结果 */
export interface FullReviewResult extends SimpleReviewResult {
  /** 每手棋详细分析 */
  moves: MoveReview[];
  /** 分析元信息 */
  analysis: {
    mode: 'quick' | 'deep';
    visits: number;
    analysisTime: number;
  };
}

/** 恶手信息 */
export interface BadMove {
  /** 手数 */
  moveNumber: number;
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
  /** 执棋方 */
  color: PlayerColor;
  /** 胜率损失 */
  winRateLoss: number;
  /** 严重程度 */
  severity: 'minor' | 'moderate' | 'severe';
  /** 更好的着法 */
  betterMove?: { x: number; y: number; winRate: number; scoreLead: number };
}

/** 复盘状态 */
export interface ReviewState {
  /** 复盘 ID */
  id: string;
  /** 棋谱信息 */
  gameInfo: {
    black: string;
    white: string;
    komi: number;
    result?: string;
  };
  /** 让子棋的初始棋子 */
  handicapStones: Array<{ x: number; y: number; color: PlayerColor }>;
  /** 总手数 */
  totalMoves: number;
  /** 是否正在分析 */
  analyzing: boolean;
  /** 分析进度 */
  progress: number;
}
