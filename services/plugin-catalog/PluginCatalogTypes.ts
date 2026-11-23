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
  /** 可选：面板筛选分类（人工标注），缺省时宿主按 pointId 兜底推导 */
  category?: string;
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
  /** 可选：面板筛选分类；与 registry 条目一致时才采用（以 registry 为准） */
  category?: string;
  /** workflow-operator 专用：算子方法白名单；宿主据此注册算子表条目与 method 校验 */
  exposes?: OperatorExposure[];
  /** workflow-operator 专用：安装前沙箱自检样例 */
  smoke?: OperatorSmokeCase[];
}

/** workflow-operator 资源对外暴露的一个方法 */
export interface OperatorExposure {
  name: string;
  description: string;
  /** 参数 JSON Schema，作为宿主算子表条目的参数形状 */
  params: Record<string, unknown>;
}

/** workflow-operator 安装自检的一条：用 args 调 call，结果与 expect 逐字段相等才落库 */
export interface OperatorSmokeCase {
  /** 该样例调用的方法名；省略时用 exposes[0].name（单方法库的常见情形） */
  method?: string;
  args: unknown[];
  expect: unknown;
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
  /** 可选：清单声明的分类标签（纯展示），缺省由 UI 按 pointId 兜底推导 */
  category?: string;
  state: CatalogEntryState;
  /** 远端源码全文；只有成功取到的 plugin 才有 */
  remoteCode?: string;
  /** 安装用：manifest.intent / origin */
  intent?: string;
  origin?: 'llm' | 'manual';
  /** workflow-operator 专用：随条目透传，安装试跑与算子表条目都要用 */
  exposes?: OperatorExposure[];
  smoke?: OperatorSmokeCase[];
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
