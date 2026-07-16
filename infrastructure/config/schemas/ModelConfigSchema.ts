/**
 * Model 模块配置模式
 * @description 定义 Model 模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';

/**
 * 模型配置
 */
export interface IModelConfig {
  /** 模型列表 */
  models: Array<{
    /** 模型 ID */
    id: string;
    /** 模型名称 */
    name: string;
    /** 模型描述 */
    description: string;
    /** 官网下载地址 */
    url: string;
    /** Web 端代理地址 */
    proxyUrl?: string;
    /** 备选 URL */
    fallbackUrl?: string;
    /** 显示大小（如 "4.7MB"） */
    size: string;
    /** 字节大小 */
    sizeBytes: number;
    /** 版本号 */
    version: string;
    /** 网络层数 */
    blocks: number;
    /** 是否为默认模型 */
    isDefault: boolean;
    /** 推荐场景 */
    recommended?: string[];
    /** 支持的难度 */
    difficulty?: string[];
    /** 特性 */
    features: {
      fastInference: boolean;
      lowMemory: boolean;
    };
  }>;

  /** 元数据 */
  metadata: {
    /** 配置版本 */
    version: string;
    /** 最后更新时间 */
    lastUpdated: string;
    /** 来源 */
    source: string;
  };

  /** 模型缓存 TTL（毫秒），默认 7 天 */
  modelCacheTTL: number;

  /** 是否启用模型缓存，默认 true */
  enableModelCache: boolean;
}

/**
 * Model 配置模式
 */
export const ModelConfigSchema: IConfigSchemaDefinition<IModelConfig> = {
  models: {
    type: 'array',
    required: true,
    description: '模型列表',
    items: {
      type: 'object',
      required: true,
      properties: {
        id: {
          type: 'string',
          required: true,
          description: '模型 ID',
          minLength: 1,
        },
        name: {
          type: 'string',
          required: true,
          description: '模型名称',
          minLength: 1,
        },
        description: {
          type: 'string',
          required: true,
          description: '模型描述',
        },
        url: {
          type: 'string',
          required: true,
          description: '官网下载地址',
        },
        proxyUrl: {
          type: 'string',
          required: false,
          description: 'Web 端代理地址',
        },
        fallbackUrl: {
          type: 'string',
          required: false,
          description: '备选 URL',
        },
        size: {
          type: 'string',
          required: true,
          description: '显示大小',
        },
        sizeBytes: {
          type: 'number',
          required: true,
          description: '字节大小',
          minValue: 0,
        },
        version: {
          type: 'string',
          required: true,
          description: '版本号',
        },
        blocks: {
          type: 'number',
          required: true,
          description: '网络层数',
          minValue: 1,
        },
        isDefault: {
          type: 'boolean',
          required: true,
          description: '是否为默认模型',
        },
        recommended: {
          type: 'array',
          required: false,
          description: '推荐场景',
        },
        difficulty: {
          type: 'array',
          required: false,
          description: '支持的难度',
        },
        features: {
          type: 'object',
          required: true,
          description: '特性',
          properties: {
            fastInference: {
              type: 'boolean',
              required: true,
              description: '快速推理',
            },
            lowMemory: {
              type: 'boolean',
              required: true,
              description: '低内存占用',
            },
          },
        },
      },
    },
  },
  metadata: {
    type: 'object',
    required: true,
    description: '元数据',
    properties: {
      version: {
        type: 'string',
        required: true,
        description: '配置版本',
      },
      lastUpdated: {
        type: 'string',
        required: true,
        description: '最后更新时间',
      },
      source: {
        type: 'string',
        required: true,
        description: '来源',
      },
    },
  },
  modelCacheTTL: {
    type: 'number',
    required: false,
    description: '模型缓存 TTL（毫秒）',
    defaultValue: 604800000, // 7 天
    minValue: 0, // 0 表示永久缓存
  },
  enableModelCache: {
    type: 'boolean',
    required: false,
    description: '是否启用模型缓存',
    defaultValue: true,
  },
};
