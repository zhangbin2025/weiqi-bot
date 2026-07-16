/**
 * Storage 模块配置模式
 * @description 定义 Storage 模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import { Platform } from '../interfaces';

/**
 * Storage 模块配置
 */
export interface IStorageConfig {
  /** 默认命名空间 */
  defaultNamespace: string;

  /** 缓存配置 */
  cache: {
    /** L1 缓存大小（字节） */
    l1MaxSize: number;
    /** L2 缓存过期时间（毫秒） */
    l2ExpireTime: number;
  };

  /** 大文件阈值（字节） */
  largeFileThreshold: number;
}

/**
 * Storage 配置模式
 */
export const StorageConfigSchema: IConfigSchemaDefinition<IStorageConfig> = {
  defaultNamespace: {
    type: 'string',
    default: 'weiqi',
    required: true,
    description: '默认命名空间',
    minLength: 1,
    maxLength: 50,
    platformOverrides: {
      [Platform.Web]: 'weiqi-web',
      [Platform.MiniProgram]: 'weiqi-mp',
      [Platform.Desktop]: 'weiqi-desktop',
      [Platform.Mobile]: 'weiqi-mobile',
      [Platform.Server]: 'weiqi-server',
    },
  },
  cache: {
    type: 'object',
    required: true,
    description: '缓存配置',
    properties: {
      l1MaxSize: {
        type: 'number',
        default: 50 * 1024 * 1024, // 50MB
        required: true,
        description: 'L1 缓存大小（字节）',
        minValue: 1024 * 1024, // 最小 1MB
        maxValue: 500 * 1024 * 1024, // 最大 500MB
        validate: (value: number) => value > 0 && value <= 500 * 1024 * 1024,
      },
      l2ExpireTime: {
        type: 'number',
        default: 24 * 60 * 60 * 1000, // 24小时
        required: true,
        description: 'L2 缓存过期时间（毫秒）',
        minValue: 60 * 1000, // 最小 1分钟
        maxValue: 30 * 24 * 60 * 60 * 1000, // 最大 30天
      },
    },
  },
  largeFileThreshold: {
    type: 'number',
    default: 10 * 1024 * 1024, // 10MB
    required: true,
    description: '大文件阈值（字节）',
    minValue: 1024, // 最小 1KB
    maxValue: 1000 * 1024 * 1024, // 最大 1GB
  },
};
