/**
 * Opponent 模块配置模式
 * @description 定义对手分析服务的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';

/**
 * Opponent 模块配置
 */
export interface IOpponentConfig {
  /** 分析结果缓存 TTL（毫秒），默认 1 小时 */
  cacheTTL: number;
  
  /** 最大分析棋谱数量，默认 20 */
  maxGames: number;
  
  /** 最大历史记录数，默认 20 */
  maxHistory: number;
}

/**
 * Opponent 配置模式
 */
export const OpponentConfigSchema: IConfigSchemaDefinition<IOpponentConfig> = {
  cacheTTL: {
    type: 'number',
    default: 3600000,
    description: '分析结果缓存时间（毫秒）',
    minValue: 60000,      // 最小 1 分钟
    maxValue: 86400000,   // 最大 24 小时
  },
  maxGames: {
    type: 'number',
    default: 20,
    description: '最大分析棋谱数量',
    minValue: 1,
    maxValue: 100,
  },
  maxHistory: {
    type: 'number',
    default: 20,
    description: '最大历史记录数',
    minValue: 5,
    maxValue: 50,
  },
};