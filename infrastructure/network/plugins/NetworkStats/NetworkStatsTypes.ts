/**
 * 网络统计类型定义
 */

/**
 * 网络统计条目
 */
export interface INetworkStats {
  /** 总请求数 */
  totalRequests: number;

  /** 成功请求数 */
  successRequests: number;

  /** 失败请求数 */
  failedRequests: number;

  /** 成功率 */
  successRate: number;

  /** 平均响应时间（毫秒） */
  averageResponseTime: number;

  /** 最小响应时间（毫秒） */
  minResponseTime: number;

  /** 最大响应时间（毫秒） */
  maxResponseTime: number;

  /** 总流量（字节） */
  totalBytes: number;

  /** 平均流量（字节） */
  averageBytes: number;
}

/**
 * 按URL统计
 */
export interface IUrlStats extends INetworkStats {
  /** URL */
  url: string;

  /** 请求次数 */
  requestCount: number;
}

/**
 * 按方法统计
 */
export interface IMethodStats extends INetworkStats {
  /** 请求方法 */
  method: string;

  /** 请求次数 */
  requestCount: number;
}

/**
 * 按提供者统计
 */
export interface IProviderStats extends INetworkStats {
  /** 提供者名称 */
  provider: string;

  /** 请求次数 */
  requestCount: number;
}

/**
 * 统计配置
 */
export interface INetworkStatsConfig {
  /** 是否启用统计 */
  enabled?: boolean;

  /** 统计时间窗口（毫秒） */
  timeWindow?: number;

  /** 是否按URL统计 */
  groupByUrl?: boolean;

  /** 是否按方法统计 */
  groupByMethod?: boolean;

  /** 是否按提供者统计 */
  groupByProvider?: boolean;

  /** 自定义统计处理器 */
  customHandler?: (stats: INetworkStats) => void;
}
