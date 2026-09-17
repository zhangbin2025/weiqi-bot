/**
 * @fileoverview OGS 死活题提供者接口
 */

import type { FetchResult } from '../base/types';

/**
 * OGS 死活题提供者接口
 *
 * 提供从 OGS (Online-Go.com) 下载死活题棋谱的功能。
 *
 * @ai-example
 * const provider: IOgsPuzzleProvider = new OgsPuzzleProvider(network);
 * const result = await provider.fetch('https://online-go.com/puzzle/45');
 */
export interface IOgsPuzzleProvider {
  /**
   * 判断是否支持该 URL
   */
  canHandle(url: string): boolean;

  /**
   * 从 URL 提取题目 ID
   */
  extractId(url: string): string | null;

  /**
   * 下载死活题棋谱
   */
  fetch(url: string): Promise<FetchResult>;

  /**
   * 通过题目 ID 获取死活题数据
   */
  fetchById(puzzleId: string): Promise<FetchResult>;

  /**
   * 获取死活题列表
   */
  fetchPuzzleList(
    count?: number,
    keyword?: string,
  ): Promise<Array<{ title: string; subtitle: string; date: string; url: string }>>;
}
