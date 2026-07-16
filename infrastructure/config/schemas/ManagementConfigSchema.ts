/**
 * Management 模块配置模式
 * @description 定义管理服务的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces/index.js';

/**
 * 管理配置
 */
export interface IManagementConfig {
  /** 代理服务器 URL */
  proxyUrl: string;
  /** version.json 的 URL */
  versionUrl: string;
  /** 请求超时时间（毫秒） */
  timeout: number;
}

/**
 * Management 配置模式
 */
export const ManagementConfigSchema: IConfigSchemaDefinition<IManagementConfig> = {
  proxyUrl: {
    type: 'string',
    required: false,
    description: '代理服务器 URL',
  },
  versionUrl: {
    type: 'string',
    required: false,
    description: 'version.json 的 URL',
  },
  timeout: {
    type: 'number',
    required: false,
    description: '请求超时时间（毫秒）',
    defaultValue: 30000,
  },
};
