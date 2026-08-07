/**
 * 性能浏览服务类型定义
 * @module services/performance/types
 */

/**
 * 内存使用信息（格式化后）
 */
export interface MemoryDisplayInfo {
  /** 最大可用内存（字节） */
  max: number;
  /** 最大可用内存（格式化） */
  maxFormatted: string;
  /** 总内存（字节） */
  total: number;
  /** 总内存（格式化） */
  totalFormatted: string;
  /** 已使用内存（字节） */
  used: number;
  /** 已使用内存（格式化） */
  usedFormatted: string;
  /** 空闲内存（字节） */
  free: number;
  /** 空闲内存（格式化） */
  freeFormatted: string;
  /** 使用百分比 */
  usagePercent: number;
}

/**
 * 系统显示信息
 */
export interface SystemDisplayInfo {
  /** 设备型号 */
  device: string;
  /** 操作系统 */
  os: string;
  /** App 版本 */
  appVersion: string;
  /** 平台 */
  platform: string;
}

/**
 * 性能概览数据
 */
export interface PerformanceOverview {
  /** 内存信息 */
  memory: MemoryDisplayInfo;
  /** 系统信息 */
  system: SystemDisplayInfo;
}
