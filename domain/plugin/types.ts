/**
 * 插件系统核心契约
 * @module domain/plugin/types
 *
 * 设计要点：
 * - 插件是「可编程工件」：LLM 产出完整 JS 源码，宿主在 QuickJS 沙箱里执行。
 * - 工件（Artifact）是唯一真相，自带 intent/code/spec/history，
 *   不依赖任何聊天会话；会话丢失后仍可继续修订。
 * - 沙箱默认零能力：只有 spec.hostApi 显式列出的纯函数才会被注入。
 */

/** 扩展点标识。一期只有 ranking.tiebreak，后续可扩展 */
export type ExtensionPointId = string;

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

/** 输出契约校验结果 */
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

/**
 * 扩展点契约快照，随工件一起持久化。
 * 版本化后，旧工件不会因为系统升级而静默改变行为。
 */
export interface PluginSpec {
  pointId: ExtensionPointId;
  version: number;
  /** 约定的入口函数名，例如 rank */
  entry: string;
  /** 允许注入的宿主纯函数名白名单，默认空数组 */
  hostApi: string[];
  limits: PluginLimits;
}

export const RANKING_SPEC: PluginSpec = {
  pointId: 'ranking.tiebreak',
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
  /** 同时作为 IDocumentStorage 的 id */
  id: string;
  name: string;
  pointId: ExtensionPointId;
  version: number;
  enabled: boolean;
  origin: 'llm' | 'manual';
  /** 用户最初的自然语言需求 */
  intent: string;
  /** 当前生效的完整源码（永远全量，不是 diff） */
  code: string;
  spec: PluginSpec;
  /** 可选作用域。省略表示全局可用 */
  scope?: { eventId?: number };
  createdAt: number;
  updatedAt: number;
  history: PluginRevision[];
  /** 可选：仅用于「打开原会话」，丢失不影响任何能力 */
  conversationRef?: string;
}

/** 注入 system prompt 的插件清单条目（默认不含代码，按需展开） */
export interface PluginContextEntry {
  id: string;
  name: string;
  pointId: string;
  enabled: boolean;
  version: number;
  intent: string;
  /** 仅在与本次对话相关时展开 */
  code?: string;
}

/** 回喂 LLM 的反馈包 */
export interface RepairFeedback {
  phase: FailurePhase;
  ok: false;
  error?: PluginError;
  contract?: ContractCheck;
  /** 人话提示，比原始报错更利于模型收敛 */
  hint?: string;
  /** 输入数据的形状摘要，不含真实姓名 */
  inputShape?: string;
  /** 用户验收反馈原文 */
  userText?: string;
  attempt: number;
  maxAttempts: number;
}

/** 对话页 Agent 协议：模型输出 { reply, action } */
export type AgentActionKind =
  | 'none'
  | 'plugin.list'
  | 'plugin.show'
  | 'plugin.create'
  | 'plugin.revise'
  | 'plugin.toggle'
  | 'plugin.delete';

export interface AgentAction {
  kind: AgentActionKind;
  artifactId?: string;
  name?: string;
  code?: string;
  feedback?: string;
  pointId?: string;
  intent?: string;
  /**
   * plugin.toggle 的目标状态：true=启用，false=停用。
   * 省略时按存储中的当前状态翻转。显式给出可避免「用户说启用，
   * 模型却因快照过期翻回停用」这类方向错误。
   */
  enabled?: boolean;
}

export interface AgentResponse {
  reply: string;
  action: AgentAction;
}

/**
 * 调试过程的一步（供对话页「过程日志」折叠展示，不写进会话历史）。
 * source=codegen 是「LLM 写/改代码」的自动修复循环，source=agent 是外层决策循环。
 */
export interface PluginTraceStep {
  source: 'agent' | 'codegen';
  /** 轮次：codegen 为修复轮，agent 为决策轮 */
  attempt: number;
  /** 阶段短标签（llm / protocol / validate / sandbox / crash / decision / observe / final） */
  phase: string;
  ok: boolean;
  /** 一行人话摘要，已含轮次与结果描述 */
  detail: string;
  /** 该轮 LLM 产出的完整源码（可选，供「查看本轮代码」） */
  code?: string;
}

/**
 * 调试过程的实时推送回调。每一步产生时立刻调用（不等待整轮结束）。
 * 纯展示通道：接收方负责渲染，绝不能把步骤写进会话历史。
 */
export type PluginTraceSink = (step: PluginTraceStep) => void;

/** 一次 Agent Turn 的结果 */
export interface AgentTurnResult {
  reply: string;
  artifactId?: string;
  /** 本次是否执行了插件动作 */
  acted: boolean;
  /** 自动修复轮数 */
  attempts: number;
  /** 调试过程（可选）：对话页据此渲染可折叠的过程日志 */
  trace?: PluginTraceStep[];
}

// ---------- 端口（六边形架构：application 依赖端口，infrastructure 实现） ----------

/** 沙箱运行时端口。每轮调用应相互隔离（实现方负责一次性 Worker）。 */
export interface IPluginRuntime {
  run(code: string, input: unknown, spec: PluginSpec): Promise<PluginRunResult>;
  dispose(): Promise<void>;
}

/** 工件存储端口 */
export interface IPluginArtifactStore {
  list(): Promise<PluginArtifact[]>;
  get(id: string): Promise<PluginArtifact | null>;
  create(artifact: PluginArtifact): Promise<void>;
  update(id: string, patch: Partial<PluginArtifact>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 上下文提供者端口：给 system prompt 注入插件快照 */
export interface IPluginContextProvider {
  /** 精简清单（每次请求都带） */
  snapshot(): Promise<PluginContextEntry[]>;
  /** 带代码的完整上下文（选中某插件时） */
  withCode(id: string): Promise<PluginContextEntry | null>;
}
