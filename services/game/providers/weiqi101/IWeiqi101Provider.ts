/**
 * @fileoverview 101围棋网提供者接口
 */

import type { FetchResult } from '../base/types';

/**
 * 101围棋网提供者接口
 *
 * 提供从 101围棋网下载棋谱的功能，支持 WebSocket 实时数据获取。
 *
 * @ai-example
 * const provider: IWeiqi101Provider = new Weiqi101Provider(network, cache, config);
 * const result = await provider.fetch('https://www.101weiqi.com/play/p/12345/');
 */
export interface IWeiqi101Provider {
  /**
   * 判断是否支持该 URL
   * @param url - 待检测的 URL
   * @returns 是否支持
   */
  canHandle(url: string): boolean;

  /**
   * 从 URL 提取对局 ID
   * @param url - 游戏页面 URL
   * @returns 对局 ID
   */
  extractId(url: string): string | null;

  /**
   * 下载棋谱
   * @param url - 游戏页面 URL
   * @returns 下载结果
   */
  fetch(url: string): Promise<FetchResult>;

  /**
   * 通过对局 ID 获取棋谱数据
   * @param playId - 对局 ID
   * @returns 下载结果
   */
  fetchById(playId: string): Promise<FetchResult>;
}