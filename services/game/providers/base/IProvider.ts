/**
 * @fileoverview 棋谱下载提供者接口
 */

import type { FetchResult } from './types';

/**
 * 棋谱下载提供者接口
 *
 * 定义统一的棋谱下载接口，所有平台提供者必须实现此接口。
 *
 * @ai-example
 * const provider: IGameProvider = new OgsProvider(network, cache, config);
 * if (provider.canHandle(url)) {
 *   const result = await provider.fetch(url);
 *   console.log(result.sgfContent);
 * }
 */
export interface IGameProvider {
  /** 提供者标识（小写，如 'ogs'） */
  readonly name: string;

  /** 显示名称（如 'OGS (Online-Go)'） */
  readonly displayName: string;

  /** URL 匹配模式列表 */
  readonly urlPatterns: RegExp[];

  /**
   * 判断是否支持该 URL
   * @param url - 待检测的 URL
   * @returns 是否支持
   * @ai-example
   * const canHandle = provider.canHandle('https://online-go.com/game/12345');
   */
  canHandle(url: string): boolean;

  /**
   * 从 URL 提取对局 ID
   * @param url - 游戏页面 URL
   * @returns 对局 ID，提取失败返回 null
   * @ai-example
   * const id = provider.extractId('https://online-go.com/game/12345');
   * // id = '12345'
   */
  extractId(url: string): string | null;

  /**
   * 下载棋谱
   * @param url - 游戏页面 URL
   * @returns 下载结果
   * @ai-example
   * const result = await provider.fetch('https://online-go.com/game/12345');
   * if (result.success) {
   *   console.log(result.sgfContent);
   * }
   */
  fetch(url: string): Promise<FetchResult>;
}
