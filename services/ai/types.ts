/**
 * @fileoverview AI 服务公共类型定义
 */

import type { BoardState, PlayerColor } from '../../domain';

/** 难度等级 */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * 形势判断结果
 */
export interface IAnalysisResult {
  /** 胜率（当前玩家视角，0-1） */
  winRate: number;
  /** 领先目数 */
  scoreLead: number;
  /** 推荐着法 */
  topMoves: IMoveAnalysis[];
}

/**
 * 着法分析
 */
export interface IMoveAnalysis {
  x: number;
  y: number;
  winRate: number;
  scoreLead: number;
  visits: number;
  pv?: string[] | undefined;  // PV line（后续变化）
}
