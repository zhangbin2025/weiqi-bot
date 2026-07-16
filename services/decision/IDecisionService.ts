/**
 * 决策服务接口
 * @module services/decision/IDecisionService
 */

import type { IDecisionProblem, IDecisionResult } from '../../domain/decision';
import type { DecisionGenerateOptions, DecisionGenerateResult } from './types';

/**
 * 决策服务接口
 * @ai-example
 * const service: IDecisionService = { generateFromSGF, saveResult, getHistory };
 */
export interface IDecisionService {
  /** 从AI分析棋谱生成决策题 */
  generateFromSGF(sgf: string, options?: DecisionGenerateOptions): Promise<DecisionGenerateResult>;
  /** 保存答题结果 */
  saveResult(result: IDecisionResult): Promise<void>;
  /** 查询答题历史 */
  getHistory(userId: string, limit?: number): Promise<IDecisionResult[]>;
  /** 获取单道题目 */
  getProblem(problemId: string): Promise<IDecisionProblem | null>;
}