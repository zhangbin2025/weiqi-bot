/**
 * @fileoverview 棋力评估服务层类型
 */

import type { MoveReview, BadMove } from '../review/types';
import type { StrengthEstimate } from '../../domain/strength';

/** 棋力评估报告（黑白双方） */
export interface StrengthReport {
  black: StrengthEstimate;
  white: StrengthEstimate;
  /** 数据来源：live（内存完整分析）/ saved（已保存的复盘数据） */
  source: 'live' | 'saved';
  blackName?: string | undefined;
  whiteName?: string | undefined;
}

/**
 * 已保存复盘数据（用于无内存数据时重建）
 * 与 ReviewAnalysis.saveReviewData 落盘结构对齐。
 */
export interface SavedReviewData {
  totalMoves?: number;
  /** 每手胜率趋势（黑方视角） */
  winrateTrend?: Array<{ moveNumber: number; winRate: number; scoreLead: number }>;
  /**
   * 每手候选选点（按着法索引对齐）。
   * 元素为紧凑结构：{x,y,wr,sl,v}；无候选时为 undefined/空数组。
   */
  moveCandidates?: Array<Array<{ x: number; y: number; wr: number; sl: number; v: number }>>;
  /** 失误列表 */
  badMoves?: BadMove[];
  /** 着法序列（可按 moveNumber 对齐） */
  moves?: Array<{ x: number; y: number; color: 'black' | 'white' }>;
}

/** 估计输入：内存完整分析优先 */
export interface StrengthSource {
  kind: 'live' | 'saved';
  /** live：完整逐手分析 */
  moves?: MoveReview[];
  /** saved：紧凑复盘数据 */
  data?: SavedReviewData;
  blackName?: string;
  whiteName?: string;
}
