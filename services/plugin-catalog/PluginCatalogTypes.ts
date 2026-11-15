/**
 * 在线插件平台的资源契约（镜像 weiqi-assets 的 JSON Schema）
 * @module services/plugin-catalog/PluginCatalogTypes
 *
 * 设计边界：
 * - 这些类型是「远端资源」的形状，不是宿主的 PluginArtifact。宿主工件由
 *   PluginArtifactService.create() 生成，远端只提供 name/intent/code/pointId 等元数据。
 * - 字段刻意宽松（可选）：清单来自任意自定义源，解析阶段不做全量拒绝，
 *   由 browse 逐条校验并降级为「不可用」，避免一条坏数据拖垮整个列表。
 * - 未知字段一律忽略：schemaVersion 才是格式闸门（宿主只认 1）。
 */

/** 顶层清单 registry.json */
export interface PluginRegistry {
  schemaVersion: number;
  name: string;
  description: string;
  /** 资源相对路径的拼接基准 */
  baseUrl: string;
  resources: RegistryResource[];
}

/** registry.resources[] 的一条。全字段可选，供 browse 逐条校验 */
export interface RegistryResource {
  id?: string;
  type?: string;
  name?: string;
  summary?: string;
  path?: string;
  pointId?: string;
  specVersion?: number;
}

/** 插件条目 manifest（plugin.json） */
export interface PluginManifest {
  id: string;
  name: string;
  type: string;
  pointId: string;
  specVersion: number;
  entry: string;
  /** 源码文件的仓库根相对路径 */
  code: string;
  origin: 'llm' | 'manual';
  intent: string;
  readme?: string;
  license?: string;
  tags?: string[];
}

/**
 * 一条资源在 UI 里的状态：
 * - new            未安装 → 「安装」
 * - update          已安装且远端源码与本地不同 → 「更新」
 * - installed       已安装且一致 → 「已安装」(禁用)
 * - incompatible    宿主不认的 pointId / specVersion / 入口 / 静态预检失败 → 禁用并给原因
 * - unavailable     取清单/条目/源码失败 → 禁用并给原因
 * - tool-only       type: tool 的声明镜像 → 只展示，不提供安装按钮
 */
export type CatalogEntryState =
  | 'new'
  | 'update'
  | 'installed'
  | 'incompatible'
  | 'unavailable'
  | 'tool-only';

export interface CatalogEntry {
  /** 来源 registry 的绝对 URL（写入 catalogRef 时同源使用） */
  registryUrl: string;
  /** 是否官方默认源（只读，由 git 发布） */
  official: boolean;
  resourceId: string;
  kind: 'plugin' | 'tool';
  name: string;
  summary: string;
  pointId?: string;
  specVersion?: number;
  state: CatalogEntryState;
  /** 远端源码全文；只有成功取到的 plugin 才有 */
  remoteCode?: string;
  /** 安装用：manifest.intent / origin */
  intent?: string;
  origin?: 'llm' | 'manual';
  /** 已匹配的本地工件 id（installed / update） */
  localArtifactId?: string;
  /** 状态说明（不兼容/不可用/仅声明的原因） */
  reason?: string;
  /** 来自上次成功的缓存（源不可达时的兜底展示） */
  cached?: boolean;
}

export interface CatalogFailure {
  registryUrl: string;
  reason: string;
}

export interface CatalogBrowseResult {
  entries: CatalogEntry[];
  failures: CatalogFailure[];
}

export interface CatalogSource {
  url: string;
  /** 官方默认源只读、不可删、不可覆盖 */
  official: boolean;
}
