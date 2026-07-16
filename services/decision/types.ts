/**
 * 决策服务类型定义
 * @module services/decision/types
 */

import type { DecisionDifficulty, DecisionPhase, GameLevel, IDecisionProblem } from '../../domain/decision';

/** 题目生成选项 */
export interface DecisionGenerateOptions {
  /** 最大题目数 */
  maxCount?: number | undefined;
  /** 题目类型筛选 */
  difficulty?: DecisionDifficulty | undefined;
  /** 阶段筛选 */
  phase?: DecisionPhase | undefined;
  /** 恶手题优先 */
  blunderFirst?: boolean | undefined;
  /** 只生成恶手题 */
  blunderOnly?: boolean | undefined;
  /** 归档ID */
  archiveId?: string | undefined;
  /** 原始URL */
  url?: string | undefined;
}

/** 题目生成结果 */
export interface DecisionGenerateResult {
  problems: IDecisionProblem[];
  totalCount: number;
  stats: {
    layout: number;
    middle: number;
    endgame: number;
    easy: number;
    medium: number;
    hard: number;
    blunder: number;
  };
}