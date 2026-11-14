/**
 * 插件系统核心契约
 * @module domain/plugin/types
 *
 * 设计要点：
 * - 插件是「可编程工件」：LLM 产出完整 JS 源码，宿主在 QuickJS 沙箱里执行。
 * - 工件（Artifact）是唯一真相，自带 intent/code/spec/history，不依赖聊天会话。
 * - 沙箱默认零能力：只有 spec.hostApi 显式列出的纯函数才会被注入。
 * - 排名扩展点只有一个版本：rank({ matches }) → { columns, rows }，
 *   内置排名与插件排名共用同一契约，PDF 导入也只是提供同一份对阵表。
 * - cells（自定义数据列）值为数值或数值数组；name/rank/id 是宿主保留的只读结构列，
 *   不在 cells 里、不受数值约束。列名只允许汉字。
 */

/** 扩展点标识。当前只有一个：ranking */
export type ExtensionPointId = string;

export const RANKING_POINT_ID = 'ranking';

/** 执行失败分类，用于归一成回喂 LLM 的反馈包 */
export type FailurePhase =
  | 'compile'
  | 'runtime'
  | 'contract'
  | 'crash'
  | 'timeout'
  | 'oom'
  | 'user';

/** 沙箱/VM 给出的错误诊断 */
export interface PluginError {
  name: string;
  message: string;
  stack?: string;
  lineNumber?: number;
}

/**
 * 输出契约校验结果。
 * 新契约的输出是 { columns, rows } 对象而非数组：
 * - outputIsArray 恒为 false（保留字段仅为兼容既有诊断/反馈结构）
 * - entryFound 表示 rank 入口产出了结构合法的对象
 * - missingFields 是校验器给出的具体缺失/违规字段
 */
export interface ContractCheck {
  entryFound: boolean;
  outputIsArray: boolean;
  missingFields: string[];
}

/** 沙箱执行结果（成功） */
export interface PluginRunSuccess {
  ok: true;
  output: unknown;
  logs: string[];
  elapsedMs: number;
}

/** 沙箱执行结果（失败） */
export interface PluginRunFailure {
  ok: false;
  phase: FailurePhase;
  error?: PluginError;
  contract?: ContractCheck;
  hint?: string;
  logs: string[];
  elapsedMs: number;
}

export type PluginRunResult = PluginRunSuccess | PluginRunFailure;

/** 资源配额 */
export interface PluginLimits {
  timeoutMs: number;
  memoryBytes: number;
  maxStackBytes: number;
  maxCodeBytes: number;
  maxOutputBytes: number;
  maxLogs: number;
}

export const DEFAULT_PLUGIN_LIMITS: PluginLimits = {
  timeoutMs: 2000,
  memoryBytes: 32 * 1024 * 1024,
  maxStackBytes: 512 * 1024,
  maxCodeBytes: 32 * 1024,
  maxOutputBytes: 256 * 1024,
  maxLogs: 50,
};

/** 扩展点契约快照，随工件一起持久化（单版本，不做兼容演进） */
export interface PluginSpec {
  pointId: ExtensionPointId;
  version: number;
  /** 约定的入口函数名：rank */
  entry: string;
  /** 允许注入的宿主纯函数名白名单，默认空数组 */
  hostApi: string[];
  limits: PluginLimits;
}

export const RANKING_SPEC: PluginSpec = {
  pointId: RANKING_POINT_ID,
  version: 1,
  entry: 'rank',
  hostApi: [],
  limits: DEFAULT_PLUGIN_LIMITS,
};

/** 一次修订的留痕 */
export interface PluginRevision {
  version: number;
  code: string;
  at: number;
  trigger: 'create' | 'auto-repair' | 'user-feedback' | 'manual';
  feedback?: string;
  outcome: 'accepted' | 'rejected';
}

/** 插件工件：唯一真相，自足、可脱离会话存在 */
export interface PluginArtifact {
  id: string;
  name: string;
  pointId: ExtensionPointId;
  version: number;
  enabled: boolean;
  origin: 'llm' | 'manual';
  intent: string;
  /** 当前生效的完整源码（永远全量，不是 diff） */
  code: string;
  spec: PluginSpec;
  scope?: { eventId?: number };
  createdAt: number;
  updatedAt: number;
  history: PluginRevision[];
  conversationRef?: string;
}

/** 注入 system prompt 的插件清单条目 */
export interface PluginContextEntry {
  id: string;
  name: string;
  pointId: string;
  enabled: boolean;
  version: number;
  intent: string;
  code?: string;
}

/** 回喂 LLM 的反馈包 */
export interface RepairFeedback {
  phase: FailurePhase;
  ok: false;
  error?: PluginError;
  contract?: ContractCheck;
  hint?: string;
  inputShape?: string;
  userText?: string;
  attempt: number;
  maxAttempts: number;
}

/**
 * 统一 tool-calling 过程步骤。
 * source 只区分两条链路：'web'（闲聊/网络工具）与 'plugin'（插件开发工具）。
 * 旧的自造 JSON 动作协议（'agent' / 'codegen' 双层循环）已删除。
 */
export interface PluginTraceStep {
  source: 'web' | 'plugin';
  attempt: number;
  phase: string;
  ok: boolean;
  detail: string;
  code?: string;
}

export type PluginTraceSink = (step: PluginTraceStep) => void;

// ---------- 端口（六边形架构：application 依赖端口，infrastructure 实现） ----------

export interface IPluginRuntime {
  run(code: string, input: unknown, spec: PluginSpec): Promise<PluginRunResult>;
  dispose(): Promise<void>;
}

export interface IPluginArtifactStore {
  list(): Promise<PluginArtifact[]>;
  get(id: string): Promise<PluginArtifact | null>;
  create(artifact: PluginArtifact): Promise<void>;
  update(id: string, patch: Partial<PluginArtifact>): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface IPluginContextProvider {
  snapshot(): Promise<PluginContextEntry[]>;
  withCode(id: string): Promise<PluginContextEntry | null>;
}
