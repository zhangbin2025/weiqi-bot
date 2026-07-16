/**
 * Player 模块配置模式
 * @description 定义 Player 模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import { Platform } from '../interfaces';

/**
 * Player 模块配置
 */
export interface IPlayerConfig {
  /** 代理/API 服务器地址（用于网络层注册 Provider）*/
  proxyUrl: string;
  /** API 服务器地址（认证用户专用）*/
  apiUrl?: string;
  /** 手谈基础 URL */
  shoutanBaseUrl: string;
  /** 易查分基础 URL（已废弃，URL 常量在 YichafenUrls.ts）*/
  yichafenBaseUrl?: string;
  /** 超时时间（毫秒） */
  timeout: number;

  /** 棋手查询缓存 TTL（毫秒），默认 1 小时 */
  playerCacheTTL: number;

  /** 是否启用棋手查询缓存，默认 true */
  enablePlayerCache: boolean;
}

/**
 * Player 配置模式
 */
export const PlayerConfigSchema: IConfigSchemaDefinition<IPlayerConfig> = {
  proxyUrl: {
    type: 'string',
    required: true,
    default: 'https://api.weiqi.lol',
    description: '代理/API 服务器地址（用于网络层注册 Provider）',
  },
  apiUrl: {
    type: 'string',
    required: false,
    description: 'API 服务器地址（认证用户专用）',
  },
  shoutanBaseUrl: {
    type: 'string',
    required: true,
    default: 'https://v.dzqzd.com/SpBody.aspx',
    description: '手谈等级分查询基础 URL',
  },
  yichafenBaseUrl: {
    type: 'string',
    required: false,
    default: 'https://api.weiqi.lol/yichafen',
    description: '易查分查询基础 URL（已废弃，URL 常量在 YichafenUrls.ts）',
  },
  timeout: {
    type: 'number',
    default: 300000, // 5 分钟
    required: true,
    description: '请求超时时间（毫秒）',
    minValue: 5000,
    maxValue: 300000, // 最大 5 分钟
    validate: (value: number) => value >= 5000 && value <= 300000,
    platformOverrides: {
      [Platform.Mobile]: 300000,
      [Platform.MiniProgram]: 300000,
    },
  },
  playerCacheTTL: {
    type: 'number',
    required: false,
    description: '棋手查询缓存 TTL（毫秒）',
    defaultValue: 3600000, // 1 小时
    minValue: 60000, // 最小 1 分钟
  },
  enablePlayerCache: {
    type: 'boolean',
    required: false,
    description: '是否启用棋手查询缓存',
    defaultValue: true,
  },
};
