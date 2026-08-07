/**
 * 人机对弈配置模式（services/play/hm）
 * @description 定义人机对弈模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import type { Difficulty } from '../../../services/play/hm/types';

/**
 * 各难度默认 visits 配置
 */
export interface IDefaultVisitsConfig {
  easy: number;
  medium: number;
  hard: number;
}

/**
 * 人机对弈服务配置（服务级默认值）
 */
export interface IHMPlayServiceConfig {
  /** 默认难度等级 */
  defaultDifficulty: Difficulty;
  /** 默认 AI 模型 ID */
  defaultModelId: string;
  /** 各难度默认 visits 数 */
  defaultVisits: IDefaultVisitsConfig;
  /** 默认是否落子无悔 */
  defaultNoUndo: boolean;
}

/**
 * 人机对弈配置模式
 */
export const HMPlayConfigSchema: IConfigSchemaDefinition<IHMPlayServiceConfig> = {
  defaultDifficulty: {
    type: 'string',
    required: false,
    description: '默认难度等级',
    defaultValue: 'medium',
    validate: (value: string): value is Difficulty => 
      ['easy', 'medium', 'hard'].includes(value),
  },
  defaultModelId: {
    type: 'string',
    required: false,
    description: '默认 AI 模型 ID',
    defaultValue: 'katago-small',
  },
  defaultVisits: {
    type: 'object',
    required: false,
    description: '各难度默认 visits 数',
    defaultValue: {
      easy: 50,
      medium: 100,
      hard: 200,
    },
    validate: (value: IDefaultVisitsConfig) => 
      typeof value.easy === 'number' && 
      typeof value.medium === 'number' && 
      typeof value.hard === 'number',
  },
  defaultNoUndo: {
    type: 'boolean',
    required: false,
    description: '默认是否落子无悔',
    defaultValue: false,
  },
};
