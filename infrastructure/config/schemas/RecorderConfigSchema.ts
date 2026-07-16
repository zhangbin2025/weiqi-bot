/**
 * Recorder 模块配置模式
 * @description 定义 Recorder 模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import { Platform } from '../interfaces';

/**
 * Recorder 模块配置
 */
export interface IRecorderConfig {
  /** 保存目录 */
  saveDir: string;
  /** 自动保存 */
  autoSave: boolean;
  /** 自动保存间隔（毫秒） */
  autoSaveInterval: number;
}

/**
 * Recorder 配置模式
 */
export const RecorderConfigSchema: IConfigSchemaDefinition<IRecorderConfig> = {
  saveDir: {
    type: 'string',
    required: true,
    default: './weiqi-games',
    description: '棋谱保存目录',
  },
  autoSave: {
    type: 'boolean',
    required: true,
    default: true,
    description: '是否启用自动保存',
  },
  autoSaveInterval: {
    type: 'number',
    required: true,
    default: 30000,
    description: '自动保存间隔（毫秒）',
    minValue: 5000,
    maxValue: 300000,
    validate: (value: number) => value >= 5000 && value <= 300000,
    platformOverrides: {
      [Platform.Mobile]: 60000,
      [Platform.MiniProgram]: 60000,
    },
  },
};
