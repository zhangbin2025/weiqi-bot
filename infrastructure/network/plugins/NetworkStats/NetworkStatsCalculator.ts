/**
 * 网络统计计算器
 * @description 计算统计数据的核心逻辑
 */

import type { INetworkStats } from './NetworkStatsTypes';
import type { IStatsData } from './NetworkStatsData';

/**
 * 计算统计数据
 */
export function calculateStats(stats: IStatsData): INetworkStats {
  const successRate =
    stats.totalRequests > 0
      ? (stats.successRequests / stats.totalRequests) * 100
      : 0;

  const responseTimes = stats.responseTimes;
  const averageResponseTime =
    responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

  const minResponseTime = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;
  const maxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;

  const totalBytes = stats.bytes.reduce((a, b) => a + b, 0);
  const averageBytes = stats.bytes.length > 0 ? totalBytes / stats.bytes.length : 0;

  return {
    totalRequests: stats.totalRequests,
    successRequests: stats.successRequests,
    failedRequests: stats.failedRequests,
    successRate,
    averageResponseTime,
    minResponseTime,
    maxResponseTime,
    totalBytes,
    averageBytes
  };
}

/**
 * 标准化URL（去除查询参数和动态部分）
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch {
    return url;
  }
}