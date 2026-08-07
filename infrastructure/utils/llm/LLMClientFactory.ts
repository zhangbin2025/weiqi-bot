/**
 * LLM 客户端工厂
 * @description 根据配置创建合适的 LLM 客户端
 */

import type { ILLMClient, LLMConfig } from './types';
import { OnnxClient } from './OnnxClient';
import { WebOnnxClient } from './WebOnnxClient';
import { ApiClient } from './ApiClient';
import { LocalKeywordClient } from './LocalKeywordClient';

/**
 * LLM 客户端工厂
 * 根据配置自动选择和创建客户端实例
 */
export class LLMClientFactory {
  /**
   * 创建 LLM 客户端
   * @param config LLM 客户端配置
   * @returns LLM 客户端实例
   */
  static create(config: LLMConfig): ILLMClient {
    switch (config.provider) {
      case 'onnx':
        if (!config.modelPath) {
          throw new Error('modelPath is required for ONNX provider');
        }
        return new OnnxClient(config.modelPath);

      case 'web-onnx':
        if (!config.modelPath) {
          throw new Error('modelPath is required for Web ONNX provider');
        }
        return new WebOnnxClient(config.modelPath);

      case 'api':
        if (!config.endpoint) {
          throw new Error('endpoint is required for API provider');
        }
        return new ApiClient({
          endpoint: config.endpoint,
          ...(config.apiKey ? { apiKey: config.apiKey } : {}),
          ...(config.timeout ? { timeout: config.timeout } : {}),
        });

      case 'local':
      case 'keyword':
        return new LocalKeywordClient();

      default:
        throw new Error(`Unknown LLM provider: ${(config as any).provider}`);
    }
  }

  /**
   * 创建并初始化客户端
   * @param config LLM 客户端配置
   * @returns 已初始化的客户端实例
   */
  static async createAndInit(config: LLMConfig): Promise<ILLMClient> {
    const client = this.create(config);

    // 如果是 ONNX 客户端，调用初始化
    if (client instanceof OnnxClient || client instanceof WebOnnxClient) {
      await client.init();
    }

    return client;
  }

  /**
   * 创建默认客户端
   * 使用本地关键词匹配作为默认选择
   */
  static createDefault(): ILLMClient {
    return new LocalKeywordClient();
  }
}
