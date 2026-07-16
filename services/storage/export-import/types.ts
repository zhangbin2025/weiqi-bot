/**
 * 导出导入相关类型定义
 * @module services/storage/export-import/types
 */

/**
 * 导出清单
 */
export interface ExportManifest {
  /** 版本号 */
  version: string;
  /** 应用名称 */
  app: string;
  /** 导出时间 */
  timestamp: string;
  /** 导出数据项数量 */
  exportSize: number;
}

/**
 * 导出数据
 */
export interface ExportData {
  /** LocalStorage 数据 */
  localStorage: Record<string, string>;
  /** IndexedDB 数据 */
  indexedDB: Record<string, any>;
}
