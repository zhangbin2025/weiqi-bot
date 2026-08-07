/**
 * 网络统计内部数据结构
 * @description 内部使用的统计数据类型
 */

/**
 * 统计数据结构
 */
export interface IStatsData {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  responseTimes: number[];
  bytes: number[];
}

/**
 * 存储的数据结构
 */
export interface IStoredStats {
  global: IStatsData;
  urls: Record<string, IStatsData>;
  methods: Record<string, IStatsData>;
  providers: Record<string, IStatsData>;
}

/**
 * 创建空统计
 */
export function createEmptyStats(): IStatsData {
  return {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    responseTimes: [],
    bytes: []
  };
}

/**
 * 更新统计
 */
export function updateStats(
  stats: IStatsData,
  success: boolean,
  responseTime: number,
  bytes: number
): void {
  stats.totalRequests++;
  if (success) {
    stats.successRequests++;
  } else {
    stats.failedRequests++;
  }
  stats.responseTimes.push(responseTime);
  stats.bytes.push(bytes);
}