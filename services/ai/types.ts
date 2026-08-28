/**
 * @fileoverview AI 服务公共类型定义
 */

import type { BoardState, PlayerColor } from '../../domain';

/** 难度等级 */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'custom';

/**
 * 难度配置
 */
export interface DifficultyConfig {
  /** 搜索次数 */
  visits: number;
  /** 根节点随机性（0-5） */
  wideRootNoise?: number;
  /** 神经网络随机化 */
  nnRandomize?: boolean;
  /** 用户自定义标签 */
  label?: string;
}

/**
 * 用户自定义难度配置（用于本地存储）
 */
export interface CustomDifficulty {
  /** 唯一标识 */
  id: string;
  /** 用户自定义名称 */
  label: string;
  /** 搜索次数 */
  visits: number;
  /** 根节点随机性 */
  wideRootNoise: number;
  /** 神经网络随机化 */
  nnRandomize: boolean;
  /** 创建时间戳 */
  createdAt: number;
}

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
