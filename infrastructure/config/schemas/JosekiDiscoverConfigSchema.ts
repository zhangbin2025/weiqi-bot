/**
 * JosekiDiscover 配置模式
 * @description 定义定式发现服务的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';

/**
 * 定式发现配置
 */
export interface IJosekiDiscoverConfig {
  /** 默认最大棋谱数 */
  defaultMaxGames: number;
  /** 默认最小频率 */
  minFrequency: number;
  /** 默认最小手数 */
  minMoves: number;
  /** 默认最大手数 */
  maxMoves: number;
}

/**
 * JosekiDiscover 配置模式
 */
export const JosekiDiscoverConfigSchema: IConfigSchemaDefinition<IJosekiDiscoverConfig> = {
  defaultMaxGames: {
    type: 'number',
    required: false,
    description: '默认最大棋谱数',
    defaultValue: 10,
    minValue: 1,
    maxValue: 1000,
  },
  minFrequency: {
    type: 'number',
    required: false,
    description: '默认最小频率',
    defaultValue: 2,
    minValue: 1,
    maxValue: 100,
  },
  minMoves: {
    type: 'number',
    required: false,
    description: '默认最小手数',
    defaultValue: 3,
    minValue: 1,
    maxValue: 50,
  },
  maxMoves: {
    type: 'number',
    required: false,
    description: '默认最大手数',
    defaultValue: 20,
    minValue: 1,
    maxValue: 100,
  },
};