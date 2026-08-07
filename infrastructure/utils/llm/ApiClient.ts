/**
 * 远程 API 客户端
 * @description 通过 HTTP API 调用远程 LLM 服务
 */

import type { ILLMClient, IntentResult, EntityResult, ChatContext } from './types';

/**
 * API 客户端配置
 */
interface ApiClientConfig {
  /** API 端点 */
  endpoint: string;
  /** API 密钥 */
  apiKey?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 远程 API 客户端
 * 通过 HTTP 调用远程 LLM 服务进行意图识别和实体提取
 */
export class ApiClient implements ILLMClient {
  private endpoint: string;
  private apiKey?: string | undefined;
  private timeout: number;

  constructor(config: ApiClientConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, ''); // 移除末尾斜杠
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 5000; // 默认 5 秒超时
  }

  /**
   * 意图分类
   * 调用远程 /predict 接口
   */
  async classifyIntent(text: string): Promise<IntentResult> {
    const response = await this.request('/predict', { text });

    return {
      intent: response.intent,
      confidence: response.confidence,
    };
  }

  /**
   * 实体提取
   * 调用远程 /extract 接口或本地规则
   */
  async extractEntities(text: string, intent: string): Promise<EntityResult> {
    // 尝试调用远程 API
    try {
      const response = await this.request('/extract', { text, intent });
      return { entities: response.entities || {} };
    } catch {
      // 如果远程 API 不可用，使用本地规则
      return this.extractEntitiesLocally(text, intent);
    }
  }

  /**
   * 本地实体提取
   * 作为远程 API 不可用时的备选方案
   */
  private extractEntitiesLocally(text: string, intent: string): EntityResult {
    const entities: Record<string, any> = {};

    // 提取棋手名（使用多种模式）
    const playerPatterns = [
      /查询([\u4e00-\u9fa5]{2,4})的/,    // "查询柯洁的战绩"
      /([\u4e00-\u9fa5]{2,4})的战绩/,     // "柯洁的战绩"
      /([\u4e00-\u9fa5]{2,4})对/,         // "柯洁对战"
      /棋手([\u4e00-\u9fa5]{2,4})/,       // "棋手柯洁"
    ];

    for (const pattern of playerPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        entities['player'] = match[1];
        break;
      }
    }

    // 提取平台
    const platforms = ['野狐', '弈城', '腾讯', 'OGS', 'KGS'];
    for (const platform of platforms) {
      if (text.includes(platform)) {
        entities['platform'] = platform;
        break;
      }
    }

    // 提取难度
    const difficultyPattern = /(简单|中等|困难|高级|初级)/;
    const difficultyMatch = text.match(difficultyPattern);
    if (difficultyMatch && difficultyMatch[1]) {
      entities['difficulty'] = difficultyMatch[1];
    }

    return { entities };
  }

  /**
   * 对话生成
   * 调用远程 LLM API（适用于复杂场景）
   */
  async chat(message: string, context: ChatContext): Promise<string> {
    const response = await this.request('/chat', {
      message,
      history: context.history,
      intent: context.intent,
    });

    return response.response || response.message || '';
  }

  /**
   * 检查是否可用
   * 通过健康检查接口验证服务状态
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.endpoint}/health`, {
        method: 'GET',
        signal: controller.signal,
        headers: this.getHeaders(),
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 发送 HTTP 请求
   */
  private async request(path: string, body: any): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.endpoint}${path}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 获取请求头
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }
}
