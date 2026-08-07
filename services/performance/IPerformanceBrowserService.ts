/**
 * 性能浏览服务接口
 * @module services/performance/IPerformanceBrowserService
 */

import type { PerformanceOverview } from './types';

/**
 * 性能浏览服务接口
 */
export interface IPerformanceBrowserService {
  /**
   * 显示性能概览
   * 
   * @returns 格式化的 Markdown 文本
   */
  showOverview(): Promise<string>;
}
