/**
 * @fileoverview OGS 提供者接口
 */

import type { FetchResult } from '../base/types';

/**
 * OGS 提供者接口
 *
 * 提供从 OGS (Online-Go.com) 下载棋谱的功能。
 *
 * @ai-example
 * const provider: IOgsProvider = new OgsProvider(network, cache, config);
 * const result = await provider.fetch('https://online-go.com/game/12345');
 */
export interface IOgsProvider {
  /**
   * 判断是否支持该 URL
   * @param url - 待检测的 URL
   * @returns 是否支持
   */
  canHandle(url: string): boolean;

  /**
   * 从 URL 提取游戏 ID
   * @param url - 游戏页面 URL
   * @returns 游戏 ID
   */
  extractId(url: string): string | null;

  /**
   * 下载棋谱
   * @param url - 游戏页面 URL
   * @returns 下载结果
   */
  fetch(url: string): Promise<FetchResult>;

  /**
   * 通过游戏 ID 获取游戏数据
   * @param gameId - 游戏 ID
   * @returns 下载结果
   */
  fetchById(gameId: string): Promise<FetchResult>;
}