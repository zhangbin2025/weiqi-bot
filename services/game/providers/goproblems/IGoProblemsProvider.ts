/**
 * @fileoverview goproblems.com 提供者接口
 */

import type { FetchResult } from '../base/types';

/**
 * goproblems.com 提供者接口
 *
 * 提供从 goproblems.com 下载死活题棋谱的功能。
 * 通过 REST API 获取题目数据和 SGF 内容。
 *
 * @ai-example
 * const provider: IGoProblemsProvider = new GoProblemsProvider(network);
 * const result = await provider.fetch('https://goproblems.com/18982');
 */
export interface IGoProblemsProvider {
  /**
   * 判断是否支持该 URL
   */
  canHandle(url: string): boolean;

  /**
   * 从 URL 提取题目 ID
   */
  extractId(url: string): string | null;

  /**
   * 下载题目 SGF
   */
  fetch(url: string): Promise<FetchResult>;

  /**
   * 通过题目 ID 获取 SGF
   */
  fetchById(problemId: string): Promise<FetchResult>;

  /**
   * 获取题目列表（支持关键字过滤）
   * @param count - 最大数量
   * @param keyword - 可选关键字（如难度 'kyu'/'dan' 或类型 'life and death'）
   */
  fetchProblemList(count?: number, keyword?: string): Promise<Array<{
    title: string;
    subtitle: string;
    date: string;
    url: string;
  }>>;
}
