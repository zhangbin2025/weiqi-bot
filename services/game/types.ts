/**
 * @fileoverview Game 服务类型定义（补充）
 */

import type { FetchResult, GameMetadata, PerformanceTiming } from './providers/base/types';

/**
 * Game 服务配置
 */
export interface IGameServiceConfig {
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 是否启用 WebSocket（101围棋） */
  enableWebSocket?: boolean;
}

/**
 * Game 服务接口
 *
 * 提供统一的棋谱下载服务，自动路由到不同的平台提供者。
 *
 * @ai-example
 * const service: IGameService = new GameService(network, cache, config);
 * const result = await service.fetch('https://online-go.com/game/12345');
 * console.log(result.sgfContent);
 */
export interface IGameService {
  /**
   * 从 URL 下载棋谱
   * @param url - 游戏页面 URL
   * @returns 下载结果
   * @ai-example
   * const result = await service.fetch('https://online-go.com/game/12345');
   */
  fetch(url: string): Promise<FetchResult>;

  /**
   * 检测 URL 是否支持
   * @param url - 待检测的 URL
   * @returns 是否支持
   */
  canHandle(url: string): boolean;

  /**
   * 获取支持的提供者列表
   * @returns 提供者名称列表
   */
  getSupportedProviders(): string[];
}

// 重新导出基础类型
export type { FetchResult, GameMetadata, PerformanceTiming };