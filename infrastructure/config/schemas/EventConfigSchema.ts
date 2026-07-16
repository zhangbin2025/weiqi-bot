/**
 * Event 模块配置模式（赛事服务）
 * @description 定义云比赛网查询服务的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import { Platform } from '../interfaces';

/**
 * Event 模块配置
 */
export interface IEventConfig {
  /** Cloudflare Worker 代理地址 */
  proxyUrl: string;
  /** 比赛列表 API */
  eventsBaseUrl: string;
  /** 分组信息 API */
  groupsBaseUrl: string;
  /** 对阵表 API */
  againstPlanBaseUrl: string;
  /** 请求超时（毫秒） */
  timeout: number;

  /** 赛事查询缓存 TTL（毫秒），默认 30 分钟 */
  eventCacheTTL: number;

  /** 是否启用赛事查询缓存，默认 true */
  enableEventCache: boolean;
}

/**
 * Event 配置模式
 */
export const EventConfigSchema: IConfigSchemaDefinition<IEventConfig> = {
  proxyUrl: {
    type: 'string',
    required: true,
    default: 'https://api.weiqi.lol',
    description: 'Cloudflare Worker 代理地址',
  },
  eventsBaseUrl: {
    type: 'string',
    required: true,
    default: 'https://data-center.yunbisai.com/api/lswl-events',
    description: '比赛列表 API 地址',
  },
  groupsBaseUrl: {
    type: 'string',
    required: true,
    default: 'https://open.yunbisai.com/api/event/feel/list',
    description: '分组信息 API 地址',
  },
  againstPlanBaseUrl: {
    type: 'string',
    required: true,
    default: 'https://api.yunbisai.com/request/Group/Againstplan',
    description: '对阵表 API 地址',
  },
  timeout: {
    type: 'number',
    default: 30000,
    required: true,
    description: '请求超时时间（毫秒）',
    minValue: 5000,
    maxValue: 60000,
    validate: (value: number) => value >= 5000 && value <= 60000,
    platformOverrides: {
      [Platform.Mobile]: 45000,
      [Platform.MiniProgram]: 45000,
    },
  },
  eventCacheTTL: {
    type: 'number',
    required: false,
    description: '赛事查询缓存 TTL（毫秒）',
    defaultValue: 1800000, // 30 分钟
    minValue: 60000, // 最小 1 分钟
  },
  enableEventCache: {
    type: 'boolean',
    required: false,
    description: '是否启用赛事查询缓存',
    defaultValue: true,
  },
};
