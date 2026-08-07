/**
 * @fileoverview 提供者基类
 */

import type { IGameProvider } from './IProvider';
import type { FetchResult, PerformanceTiming } from './types';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';

/**
 * 提供者抽象基类
 *
 * 只负责下载，不处理缓存。缓存由 GameService 统一管理。
 */
export abstract class BaseProvider implements IGameProvider {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly urlPatterns: RegExp[];

  constructor(
    protected readonly network: NetworkManager
  ) {}

  canHandle(url: string): boolean {
    return this.urlPatterns.some(pattern => pattern.test(url));
  }

  extractId(url: string): string | null {
    for (const pattern of this.urlPatterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  }

  abstract fetch(url: string): Promise<FetchResult>;

  /**
   * 创建失败的 FetchResult
   */
  protected createErrorResult(
    url: string,
    error: string,
    timing?: PerformanceTiming
  ): FetchResult {
    return {
      success: false,
      source: this.name,
      url,
      sgfContent: null,
      metadata: {
        source: this.name,
        gameId: '',
        blackName: '',
        whiteName: '',
        width: 19,
        height: 19,
        komi: 6.5,
        handicap: 0,
        rules: '',
        date: '',
        movesCount: 0,
      },
      error,
      timing,
    };
  }

  /**
   * 获取当前时间戳（毫秒）
   */
  protected now(): number {
    return Date.now();
  }
}
