/**
 * Joseki 模块配置模式
 * @description 定义定式服务的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';

/**
 * 定式配置
 */
export interface IJosekiConfig {
  /** 定式数据路径（本地） */
  dataPath: string;
  /** 定式数据 URL（网络） */
  dataUrl: string;
  /** Trie 元数据文件名 */
  trieMetaFile: string;
  /** 是否启用动态加载 */
  enableDynamicLoad: boolean;
  /** 挑战题目数量限制 */
  maxQuizQuestions: number;
  /** 收藏数量限制 */
  maxFavorites: number;
  /** 缓存过期时间（毫秒） */
  cacheTTL: number;
}

/**
 * Joseki 配置模式
 */
export const JosekiConfigSchema: IConfigSchemaDefinition<IJosekiConfig> = {
  dataPath: {
    type: 'string',
    required: false,
    description: '定式数据路径（本地）',
    defaultValue: './data/joseki',
  },
  dataUrl: {
    type: 'string',
    required: true,
    description: '定式数据 URL（网络）',
  },
  trieMetaFile: {
    type: 'string',
    required: false,
    description: 'Trie 元数据文件名',
    defaultValue: 'trie-meta.json',
  },
  enableDynamicLoad: {
    type: 'boolean',
    required: false,
    description: '是否启用动态加载',
    defaultValue: false,
  },
  maxQuizQuestions: {
    type: 'number',
    required: false,
    description: '挑战题目数量限制',
    defaultValue: 100,
    minValue: 1,
    maxValue: 1000,
  },
  maxFavorites: {
    type: 'number',
    required: false,
    description: '收藏数量限制',
    defaultValue: 50,
    minValue: 1,
    maxValue: 500,
  },
  cacheTTL: {
    type: 'number',
    required: false,
    description: '缓存过期时间（毫秒）',
    defaultValue: 86400000, // 24 小时
    minValue: 60000, // 最小 1 分钟
  },
};