/**
 * 观摩对弈配置模式（services/play/mm）
 * @description 定义观摩对弈模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';

/**
 * 观摩对弈配置
 */
export interface IMMPlayConfig {
  /** 自动播放间隔（毫秒） */
  autoPlayInterval: number;
  /** 默认 AI 模型 ID */
  defaultModelId: string;
}

/**
 * 观摩对弈配置模式
 */
export const MMPlayConfigSchema: IConfigSchemaDefinition<IMMPlayConfig> = {
  autoPlayInterval: {
    type: 'number',
    required: false,
    description: '自动播放间隔（毫秒）',
    defaultValue: 1000,
    minValue: 100,
    maxValue: 10000,
    validate: (value: number) => value >= 100 && value <= 10000,
  },
  defaultModelId: {
    type: 'string',
    required: false,
    description: '默认 AI 模型 ID',
    defaultValue: 'katago-small',
  },
};
