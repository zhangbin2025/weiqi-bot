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

/**
 * 扩展点标识。注册表 PLUGIN_SPECS 决定宿主认哪些值；
 * 资源侧（weiqi-assets）不得自造，否则安装时会被判 incompatible。
 */
export type ExtensionPointId = string;

export const RANKING_POINT_ID = 'ranking';
/** 工作流算子插件：注册进宿主算子表（OperatorRegistry），阶段二 workflow runner 按名调用，入口 call({method,args}) */
export const WORKFLOW_OPERATOR_POINT_ID = 'workflow-operator';

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
  /**
   * 校验器给出的可操作诊断（含具体行/列定位）。
   * 框架只透传、不解读；由扩展点行为的 contractHint 原样带出给模型，
   * 避免只有一句笼统结论导致 LLM 反复盲改。可选：通用校验器可不提供。
   */
  hint?: string;
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
  // 放宽到 64KB（2026-11-17）：当时 workflow-operator.lunar（农历插件，现已下架）
  // 装入 1901–2100 全量节气事实表后，可读源码实测约 40KB，旧 32KB 会卡在安装预检。
  // 此值不是扫描/拟合出来的阈值：取 2 的幂上取整到「实测字节 + 余量」的自然边界，
  // 仅为「一份事实表源码放得下」。资源虽下架，该数值的历史出处保留，不另行收窄。
  // 真正防失控的是运行时 memoryBytes / maxStackBytes / timeoutMs / maxOutputBytes，
  // maxCodeBytes 只做安装期静态预检，放宽不会扩大沙箱能力。
  maxCodeBytes: 64 * 1024,
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

/**
 * 工作流算子插件的契约快照。与 ranking 共用同一套工件 / 存储 / 沙箱 / 配额，
 * 差别只在入口与输出语义：call({method,args}) → 任意可 JSON 序列化的值。
 * 方法白名单与安装自检样例由资源侧 plugin.json 的 exposes[] / smoke[] 声明，
 * 不放进 spec —— spec 是宿主常量，不随资源变化。
 */
export const WORKFLOW_OPERATOR_SPEC: PluginSpec = {
  pointId: WORKFLOW_OPERATOR_POINT_ID,
  version: 1,
  entry: 'call',
  hostApi: [],
  limits: DEFAULT_PLUGIN_LIMITS,
};

/** 宿主已注册的扩展点。新增扩展点只需在这里加一条，不要在各处硬编码 pointId */
export const PLUGIN_SPECS: Readonly<Record<string, PluginSpec>> = {
  [RANKING_POINT_ID]: RANKING_SPEC,
  [WORKFLOW_OPERATOR_POINT_ID]: WORKFLOW_OPERATOR_SPEC,
};

/** 按 pointId 取宿主 spec；不认识返回 undefined（catalog 据此标 incompatible） */
export function resolvePluginSpec(pointId: string | undefined): PluginSpec | undefined {
  if (pointId === undefined) return undefined;
  return PLUGIN_SPECS[pointId];
}

/**
 * 在线插件来源标记。写入工件后即可识别「远程这个资源 == 本地哪个工件」，
 * 用来把安装按钮切换为更新按钮。放在工件里而不是另建映射表，
 * 是为了让「工件是唯一真相」继续成立：删除工件时来源标记随之消失，
 * 不会出现孤儿映射。来源：weiqi-assets/registry.json 的条目与所在清单 URL。
 */
export interface PluginCatalogRef {
  /** 取到该资源的 registry 绝对 URL */
  registryUrl: string;
  /** registry.resources[].id，发布后稳定不变 */
  resourceId: string;
}

/** 一次修订的留痕 */
export interface PluginRevision {
  version: number;
  code: string;
  at: number;
  trigger: 'create' | 'auto-repair' | 'user-feedback' | 'manual';
  feedback?: string;
  outcome: 'accepted' | 'rejected';
}

/** workflow-operator 工件随源码一起持久化的算子契约（来自 plugin.json 的 exposes[]/smoke[]） */
export interface OperatorArtifactContract {
  exposes: Array<{ name: string; description: string; params: Record<string, unknown> }>;
  smoke: Array<{ method?: string; args: unknown[]; expect: unknown }>;
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
  /** 从在线插件源安装的工件才带；LLM/手工新建的工件没有此字段 */
  catalogRef?: PluginCatalogRef;
  /**
   * 可选：自建插件算子的稳定命名空间（短名）。LLM/手工新建 workflow-operator 时
   * 由 plugin_write 的 slug 参数给一次，随后注册进算子表为 <slug>.<exposes[].name>，
   * 技能配方的 workflow.steps[].call 才能稳定引用它（不依赖生成式 artifact.id）。
   * 发布到 weiqi-assets 时由宿主映射成 registry 的 `workflow-operator.<slug>` resourceId；
   * 在线安装件不需要此字段（它们的命名空间来自 catalogRef.resourceId）。
   */
  slug?: string;
  /** 可选：面板筛选用的分类标签（纯展示）。在线安装时取 registry 的 category；
   *  缺省由宿主按 pointId 兜底推导，见 presentation/adapters/web/pages/assistant/ChatPage.ts 的 pluginCategory() */
  category?: string;
  /** 仅 workflow-operator 工件带：安装时把方法白名单与自检样例一起落库，离线也能重建宿主算子表条目 */
  operatorContract?: OperatorArtifactContract;
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
  /** 自建算子的稳定短名；无则省略（在线安装件走 catalogRef.resourceId） */
  slug?: string;
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
  /**
   * 换 keyPath：把 oldId 的文档原样搬到 newId（文档内 .id 同步改写）。
   * 实现须保证「先写新、后删旧」，中途失败宁可留下新副本也不丢原工件；
   * newId 已存在 / oldId 不存在一律抛错，由 service 统一回执。
   */
  replaceId(oldId: string, newId: string): Promise<void>;
}

export interface IPluginContextProvider {
  snapshot(): Promise<PluginContextEntry[]>;
  withCode(id: string): Promise<PluginContextEntry | null>;
}

// ---------- 算子层统一地基（阶段一） ----------

/** 算子统一出参：连线只认 value；effects 走既有宿主渲染/动作通道 */
export interface StepResult {
  value: unknown;                 // 任意可 JSON 序列化值
  effects?: { displayMarkdown?: string; actionLink?: string }[];
  meta?: Record<string, unknown>;
}
/** 算子表条目：按名执行 value→value */
export interface OperatorSpec {
  name: string;                   // 内置 snake_case；插件 `<slug>.<exposes[].name>`
  idempotent: boolean;            // kv_write / secret_prompt 为 false
  run(args: Record<string, unknown>): Promise<StepResult>;
}
