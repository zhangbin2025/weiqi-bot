/**
 * Network 模块配置模式
 * @description 定义 Network 模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import { Platform } from '../interfaces';

/**
 * Network 模块配置
 */
export interface INetworkConfig {
  /** 代理服务器 URL */
  proxyUrl?: string;

  /** 认证 API URL */
  authApiUrl?: string;

  /** 默认超时时间（毫秒） */
  defaultTimeout: number;

  /** 重试次数 */
  retryCount: number;

  /** 是否启用缓存 */
  enableCache: boolean;
}

/**
 * Network 配置模式
 */
export const NetworkConfigSchema: IConfigSchemaDefinition<INetworkConfig> = {
  proxyUrl: {
    type: 'string',
    required: false,
    description: '代理服务器 URL',
    platformOverrides: {},
  },
  authApiUrl: {
    type: 'string',
    required: false,
    description: '认证 API URL',
  },
  defaultTimeout: {
    type: 'number',
    default: 30000, // 30秒
    required: true,
    description: '默认超时时间（毫秒）',
    minValue: 1000, // 最小 1秒
    maxValue: 300000, // 最大 5分钟
    validate: (value: number) => value > 0 && value <= 300000,
    platformOverrides: {
      [Platform.Mobile]: 60000, // 移动端网络较慢，超时时间更长
      [Platform.MiniProgram]: 60000, // 小程序网络较慢
    },
  },
  retryCount: {
    type: 'number',
    default: 3,
    required: true,
    description: '重试次数',
    minValue: 0,
    maxValue: 10,
    validate: (value: number) => value >= 0 && value <= 10,
  },
  enableCache: {
    type: 'boolean',
    default: true,
    required: true,
    description: '是否启用缓存',
    platformOverrides: {
      [Platform.Server]: false, // 服务端通常不需要缓存
    },
  },
};
