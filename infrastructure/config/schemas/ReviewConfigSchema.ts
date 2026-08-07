/**
 * 复盘服务配置模式
 * @description 定义复盘服务的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';

/**
 * 复盘配置
 */
export interface IReviewConfig {
  /** 默认分析深度 */
  defaultVisits: number;
  /** 默认候选点数量 */
  defaultTopK: number;
  /** 默认分析模式 */
  defaultMode: 'quick' | 'deep';
  /** 默认贴目 */
  defaultKomi: number;
  /** 分析超时时间（毫秒） */
  analyzeTimeout: number;
}

/**
 * Review 配置模式
 */
export const ReviewConfigSchema: IConfigSchemaDefinition<IReviewConfig> = {
  defaultVisits: {
    type: 'number',
    required: false,
    description: '默认分析深度（0=Quick批量评估, 25=Fast快速, 5000=Full深度）',
    default: 0,
    minValue: 0,
    maxValue: 5000,
    validate: (value: number) => value >= 0 && value <= 5000,
  },
  defaultTopK: {
    type: 'number',
    required: false,
    description: '默认候选点数量',
    default: 5,
    minValue: 1,
    maxValue: 20,
    validate: (value: number) => value >= 1 && value <= 20,
  },
  defaultMode: {
    type: 'string',
    required: false,
    description: '默认分析模式',
    default: 'deep',
    validate: (value: string) => value === 'quick' || value === 'deep',
  },
  defaultKomi: {
    type: 'number',
    required: false,
    description: '默认贴目',
    default: 7.5,
    minValue: 0,
    maxValue: 20,
    validate: (value: number) => value >= 0 && value <= 20,
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
