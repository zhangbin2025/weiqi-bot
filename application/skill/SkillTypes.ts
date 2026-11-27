/**
 * 在线技能（Skill Recipe）核心类型 —— 本项目唯一类型来源。
 * @module application/skill/SkillTypes
 *
 * 设计：宿主原语内置且稳定；在线只发「纯声明 JSON 配方」，
 * 配方只引用宿主已注册的原语名，永远不含可执行代码。
 * 所有模块一律从这里 import，禁止另写一份同名类型。
 */

import type { ModelToolDefinition } from '../model/IModelGateway';
import type { SecretSpec } from './SecretSpec';
import type { OperatorJsonSchema, OperatorKind } from '@domain/plugin/types';

/** 宿主内置原语：真正能执行的函数。在线资源永远不含代码。 */
export interface SkillPrimitive {
  /** 与 tool name 同名，必须是宿主注册表里的固定 id */
  name: string;
  /** 传给模型的 JSON Schema */
  definition: ModelToolDefinition;
  /**
   * 算子是否幂等；kv_write / secret_prompt 等非幂等原语显式标 false，
   * 缺省由 OperatorRegistry 按 true 处理（纯计算默认幂等，明说约定不是拟合数值）。
   */
  idempotent: boolean;
  /** 算子输出契约；空 Schema 表示任意 JSON value。 */
  outputSchema: OperatorJsonSchema;
  kind: OperatorKind;
  /** 原生结构化参数；模型工具入口在边界解析 JSON，Workflow 直接传对象。 */
  execute(args: Record<string, unknown>): Promise<PrimitiveResult>;
}

export interface PrimitiveResult {
  /** 回填给模型的观察文本（role:'tool'） */
  observation: string;
  ok: boolean;
  /** 一行人话摘要，过程块显示 */
  detail: string;
  /**
   * 只读准备动作（如 web_cache_read 读缓存分页）：与 ToolOutcome.preparatory
   * 同源，不消耗自主决策轮数。宿主内置原语才会置位；在线配方不含代码、
   * 不参与此字段的构造，因此不存在远程代码借它绕过预算的路径。
   */
  preparatory?: boolean;
  /**
   * 结构化展示链接：由宿主直接渲染/落历史，绝不写进模型回复文本。
   * 用途见 ChatUseCase / ToolLoop：规避「模型复述 URL → safeReply 转义 →
   * 历史里留下 &amp; → 下一轮照抄旧链接」的多轮退化。
   */
  actionLink?: { url: string; label: string };
  /**
   * 宿主生成的结构化 markdown 展示块 ——数据旁路通道。
   * 由宿主直接渲染进用户可见层：绝不写进模型观察 / 回复文本 / ChatMessage.content，
   * 只作为独立字段落历史供 renderSession 回放。buildConversationMessages 与
   * ConversationCompactor 都只消费 content，因此它天然不进模型上下文。
   * 安全前提：字符串由宿主用固定骨架 + 逐项转义过的外部字段拼成
   * （见 DisplayJsonListPrimitive），在线纯 JSON 配方无法构造本字段。
   */
  displayMarkdown?: string;
  /** 算子的纯 value 出参；阶段二 workflow 连线只认它。渲染/动作仍走 displayMarkdown / actionLink。 */
  value?: unknown;
}

/**
 * 阶段二 workflow DAG 声明（纯 JSON、零代码、无表达式 / 无条件 / 无循环）。
 * 语义出处：PHASE2-CONTRACT.md「DSL 语义条款」与「DSL 字段形状」。
 * 连线只认上游 StepResult.value；effects 走既有宿主通道，不参与连线。
 * 供 F 代理的 WorkflowRunner / WorkflowTool 与 G 代理的配方迁移按本类型 import。
 */

/** 一条有向依赖边：从上游节点 .value 按 path 取值，注入下游参数命名为 as。 */
export interface WorkflowBinding {
  /** 上游 step id；解析期必须指向本 steps 数组中「位置更靠前」的真实节点（即无环）。 */
  from: string;
  /** 纯引用取值路径（不做拼接 / 表达式 / 函数调用）；'$' 表示整个上游 value。 */
  path: string;
  /** 注入下游 args 时的参数名。 */
  as: string;
}

/** DAG 的一个节点：调用一个算子，args 为字面量参数，bindings 覆写注入上游值。 */
export interface WorkflowStep {
  /** 节点 id，在 steps 内唯一；被 bindings[].from 引用。 */
  id: string;
  /** 算子名（内置 snake_case 或插件 <slug>.<method>）；白名单命中由装配期/运行时校验，解析期不查。 */
  call: string;
  /** 字面量参数对象（可由 bindings 覆写注入）；缺省 = 空对象。 */
  args?: Record<string, unknown>;
  /** 依赖边集合；缺省 = 无上游依赖。 */
  bindings?: WorkflowBinding[];
  /** 仅显式 true 的节点 .value 进宿主结果汇总；成功观察只回完成+句柄、不回灌模型；缺省 false。 */
  yield?: boolean;
}

/** 模型在 run_workflow 入口填空的参数契约（形状，不是代码）。 */
export interface WorkflowInput {
  /** 参数名，在 inputs 内唯一。 */
  name: string;
  /** 参数形状；宿主 runner 合并时据此校验，解析期只验枚举，不与 default 做深度交叉校验。 */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  /** 是否必填；required:true 同时给 default 不算错。 */
  required?: boolean;
  /** 配方写死的缺省值；与 type 的一致性由宿主 runner 合并时处理，解析期不深验。 */
  default?: unknown;
  /** 可选枚举表（配方数据，宿主只做校验，PHASE2-CONTRACT L1960）。 */
  enum?: unknown[];
}

/** DAG 声明：steps 顺序即拓扑序（bindings.from 只能指更前，天然无环）。 */
export interface WorkflowSpec { steps: WorkflowStep[]; }

/** 一条技能 = 纯 JSON 配方，只引用宿主原语，不含任何可执行代码 */
export interface SkillRecipe {
  schemaVersion: 1;
  /** 如 'weather.wttr' */
  id: string;
  /** 正整数 */
  version: number;
  /** 展示名 */
  name: string;
  /** 一句话，给模型看（散文命中后注入 system 的执行说明） */
  summary: string;
  /**
   * 可选路由词：短语数组，由配方自行声明「用户说什么话时选这条」，只供路由目录消费；
   * 与 summary（命中后的执行说明）正交：路由阶段只需判断要不要启用，不需要读
   * 执行细节。宿主不内置任何词、不解析词义、不做包含匹配；词由发布方从配方自身
   * 场景句提炼（有出处），目录把多路由词拼成一行、保持一技能一行。
   * 缺省 = 目录只给 id|name（自建技能、未标注配方零回归）。
   */
  routeHint?: string[];
  /** 引用的宿主原语名，必须全部存在于 SkillRegistry；否则该技能整条跳过 */
  primitives: string[];
  /**
   * 可选：本技能声明的凭据规格（纯数据）。http_fetch_auth 按 secretKey 查这张表
   * 决定 allowedHosts / header 拼法 / 重认证状态，模型运行时无法传这些参数。
   * 缺省 = 本技能不涉及凭据，老配方逐字兼容。
   */
  secrets?: SecretSpec[];
  /**
   * 可选：面板筛选用的分类标签（纯展示，不进 LLM 提示词、不参与激活判定）。
   * 由发布方在 skills/<id>/skill.json 标注，索引里同步一份；缺省时宿主按 id 命名空间兜底推导。
   */
  category?: string;
  /** 命中后追加到 system 的自然语言指令（纯文本，无代码、无 URL 模板注入） */
  prompt: string;
  /**
   * 可选：阶段二 workflow DAG 声明。存在且 steps 非空时，技能走 run_workflow 工具 +
   * 宿主 DAG runner（与散文 prompt 路径并列、同一引擎的两种声明形态，不是兼容桥）。
   * 由 parseSkillRecipe 在安装期做静态校验；primitives 可置空。
   */
  workflow?: WorkflowSpec;
  /** 可选：模型在 yield 边界填空的参数契约；与 workflow 配套，runner 合并时消费。 */
  inputs?: WorkflowInput[];
  /**
   * 可选：缺省 false = 逐字保持现有「完成+句柄」观察；true = 正常模式也把 yield 汇总回灌模型
   * （供需要据数据做分析、给理由的技能；由 WorkflowTool.successObservation 消费）。
   */
  returnToLLM?: boolean;
  /**
   * 可选：returnToLLM:true 时，声明从 yield 汇总里保留哪些顶层段给 LLM（B3 关系摘要）。
   * 出处：用户 2026-11-25 18:09「返回给 LLM 的内容实在太多了」+ 实测逐边明细 edges 占 68%
   * 且圈层结论只依赖账号级可复算计数；声明式字段白名单，不写「前 N 条」类阈值。
   * 缺省 / 无此字段 = B2 全量行为（零回归）。
   */
  llmProjection?: { keep: string[] };
}

/** 瘦索引里的一条技能摘要（完整配方在 skills/<id>/skill.json） */
export interface SkillIndexEntry {
  id: string;
  version: number;
  name: string;
  summary: string;
  routeHint?: string[];
  /** 允许空数组：workflow 配方不挂散文原语工具，只看得到索引条目时无从区分 */
  primitives: string[];
  category?: string;
  /** 相对 skills/ 目录的配方文件路径 */
  path: string;
}

/** 在线技能清单（瘦索引；单条 skill.json 里的 schemaVersion 仍是 1，语义不同） */
export interface SkillRegistryIndex {
  schemaVersion: 2;
  name: string;
  description: string;
  /** 指向 skills/ 目录；缺省由宿主按清单 URL 所在目录兜底 */
  baseUrl?: string;
  skills: SkillIndexEntry[];
}
