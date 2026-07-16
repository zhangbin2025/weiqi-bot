/**
 * @fileoverview 模型管理服务类型定义
 */

/**
 * 模型配置
 * @ai-example
 * const config: ModelConfig = {
 *   id: 'katago-small',
 *   name: 'KataGo 小模型',
 *   description: '20层网络，经典模型，稳定可靠',
 *   url: 'models/katago-small.bin.gz',
 *   size: '3.7MB',
 *   sizeBytes: 3879731,
 *   version: '1.0.0',
 *   blocks: 20,
 *   isDefault: true,
 *   features: { fastInference: true, lowMemory: true }
 * };
 */
export interface ModelConfig {
  /** 模型 ID */
  id: string;
  /** 模型名称 */
  name: string;
  /** 模型描述 */
  description: string;
  /** 模型下载 URL */
  url: string;
  /** Web 端代理地址 */
  proxyUrl?: string | undefined;
  /** 备选 URL */
  fallbackUrl?: string | undefined;
  /** 显示大小（如 "4.7MB"） */
  size: string;
  /** 字节大小 */
  sizeBytes: number;
  /** 版本号 */
  version: string;
  /** 网络层数 */
  blocks: number;
  /** 是否为默认模型 */
  isDefault: boolean;
  /** 推荐场景 */
  recommended?: (string | undefined)[];
  /** 支持的难度 */
  difficulty?: (string | undefined)[];
  /** 特性 */
  features: {
    fastInference: boolean;
    lowMemory: boolean;
  };
  /** 原生引擎模型文件（App 端专用） */
  nativeModel?: {
    /** 下载 URL */
    url: string;
    /** 文件名（在 filesDir/katago/models/ 下） */
    filename: string;
    /** 大小（字节） */
    sizeBytes: number;
    /** 对应的 KataGo 版本 */
    katagoVersion?: string;
    /** 备选下载 URL */
    fallbackUrl?: string;
  };
}

/**
 * 模型列表元数据
 */
export interface ModelListMetadata {
  /** 配置版本 */
  version: string;
  /** 最后更新时间 */
  lastUpdated: string;
  /** 来源 */
  source: string;
}

/**
 * 模型列表
 * @ai-example
 * const list: ModelList = {
 *   models: [...],
 *   metadata: { version: '1.0.0', lastUpdated: '2026-05-13', source: 'url' }
 * };
 */
export interface ModelList {
  /** 模型列表 */
  models: ModelConfig[];
  /** 元数据 */
  metadata: ModelListMetadata;
}

/**
 * 下载进度回调
 */
export type DownloadProgressCallback = (
  loaded: number,
  total: number,
  progress: number
) => void;

/**
 * 缓存模型信息
 */
export interface CachedModelInfo {
  /** 模型 ID */
  id: string;
  /** 缓存时间戳 */
  timestamp: number;
  /** 大小（字节） */
  size: number;
}

/**
 * 缓存模型数据（内部使用）
 */
export interface CachedModel {
  id: string;
  blob: Blob;
  timestamp: number;
  size: number;
}