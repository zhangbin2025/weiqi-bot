/**
 * 决策服务模块导出
 * @module services/decision
 */

// 类型
export type { DecisionGenerateOptions, DecisionGenerateResult } from './types';

// 接口
export type { IDecisionService } from './IDecisionService';

// 实现
export { DecisionGenerator } from './DecisionGenerator';
export { DecisionService } from './DecisionService';
