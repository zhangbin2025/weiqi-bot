/**
 * @fileoverview 模型服务辅助工具
 */

import type { ModelConfig, ModelList } from './types';
import type { IModelConfig } from '../../infrastructure/config/schemas/ModelConfigSchema';
import { Environment } from '../../infrastructure/network/interfaces/Environment';
import { EnvironmentDetector } from '../../infrastructure/network/core/EnvironmentDetector';
import { toAbsoluteUrl } from '../../infrastructure/utils/web/pathUtils';

/**
 * 将配置格式转换为 ModelList
 * 并将相对路径转换为绝对路径
 */
export function transformModelConfig(modelConfig: IModelConfig | undefined): ModelList {
  if (!modelConfig?.models) {
    return getDefaultModelConfig();
  }
  
  return {
    models: modelConfig.models.map(m => {
      // 转换相对路径为绝对路径
      const absoluteUrl = toAbsoluteUrl(m.url);
      const absoluteFallbackUrl = m.fallbackUrl ? toAbsoluteUrl(m.fallbackUrl) : '';
      const absoluteProxyUrl = m.proxyUrl ? toAbsoluteUrl(m.proxyUrl) : '';
      
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        url: absoluteUrl,
        fallbackUrl: absoluteFallbackUrl,
        proxyUrl: absoluteProxyUrl,
        size: m.size,
        sizeBytes: m.sizeBytes,
        version: m.version,
        blocks: m.blocks,
        isDefault: m.isDefault,
        recommended: m.recommended ?? [],
        difficulty: m.difficulty ?? [],
        features: m.features,
      };
    }),
    metadata: modelConfig.metadata,
  };
}

/**
 * 获取下载 URL 列表（按优先级排序）
 */
export function getDownloadUrls(model: ModelConfig): string[] {
  const detector = new EnvironmentDetector();
  const env = detector.detect();
  const urls: string[] = [];

  // Web 环境优先使用代理地址
  if (env === Environment.WEB && model.proxyUrl) {
    urls.push(model.proxyUrl);
  }

  // 添加主 URL
  urls.push(model.url);

  // 添加备选 URL
  if (model.fallbackUrl) {
    urls.push(model.fallbackUrl);
  }

  return urls;
}

/**
 * 默认模型配置
 */
export function getDefaultModelConfig(): ModelList {
  return {
    models: [
      {
        id: 'g170-b10c128',
        name: 'KataGo b10c128',
        description: '10块128通道网络，较强棋力',
        url: 'models/g170-b10c128.bin.gz',
        size: '10.6MB',
        sizeBytes: 11138987,
        version: 'g170',
        blocks: 10,
        isDefault: true,
        recommended: ['desktop', 'advanced'],
        difficulty: ['hard'],
        features: { fastInference: false, lowMemory: false },
      },
    ],
    metadata: {
      version: '1.5.0',
      lastUpdated: '2026-06-29',
      source: 'https://katagotraining.org/',
    },
  };
}