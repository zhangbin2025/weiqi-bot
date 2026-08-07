/**
 * 决策服务配置模式
 * @description 定义决策服务的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';

/**
 * 决策配置
 */
export interface IDecisionConfig {
  /** 默认最大题目数 */
  defaultMaxProblems: number;
  /** 默认难度 */
  defaultDifficulty: 'easy' | 'medium' | 'hard' | 'blunder';
  /** 默认阶段 */
  defaultPhase: 'layout' | 'middle' | 'endgame';
  /** 恶手优先 */
  blunderFirst: boolean;
  /** 分析超时时间（毫秒） */
  analyzeTimeout: number;
}

/**
 * Decision 配置模式
 */
export const DecisionConfigSchema: IConfigSchemaDefinition<IDecisionConfig> = {
  defaultMaxProblems: {
    type: 'number',
    required: false,
    description: '默认最大题目数',
    default: 10,
    minValue: 1,
    maxValue: 50,
    validate: (value: number) => value >= 1 && value <= 50,
  },
  defaultDifficulty: {
    type: 'string',
    required: false,
    description: '默认难度',
    default: 'medium',
    validate: (value: string) => ['easy', 'medium', 'hard', 'blunder'].includes(value),
  },
  defaultPhase: {
    type: 'string',
    required: false,
    description: '默认阶段',
    default: 'middle',
    validate: (value: string) => ['layout', 'middle', 'endgame'].includes(value),
  },
  blunderFirst: {
    type: 'boolean',
    required: false,
    description: '恶手优先',
    default: true,
  },
  analyzeTimeout: {
    type: 'number',
    required: false,
    description: '分析超时时间（毫秒）',
    default: 30000,
    minValue: 5000,
    maxValue: 300000,
    validate: (value: number) => value >= 5000 && value <= 300000,
  },
};
