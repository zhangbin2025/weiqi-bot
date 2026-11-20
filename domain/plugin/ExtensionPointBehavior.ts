/**
 * 扩展点行为契约（框架原语，零业务 import）
 * @module domain/plugin/ExtensionPointBehavior
 *
 * 设计红线：宿主框架不允许出现与具体业务绑定的模块。新增扩展点时只在装配根
 * 提供一份「声明式行为配方」，框架各处只按 pointId 查这张表分派，不再写
 * `if (pointId === 'ranking')` 之类的硬编码分支。
 *
 * 行为负责四件与扩展点语义有关、框架无法通用的事：
 *   1. 代表性试算输入 / 自定义试算输入的解析；
 *   2. 输出契约校验（纯函数，口径由扩展点自己声明）；
 *   3. 试算结果 → 回填给模型的观察文本；
 *   4. 默认 / 标签 / 契约说明文案。
 * 沙箱、配额、工件、版本链、工具循环、反馈脱敏仍全部由宿主统一提供，
 * 行为不参与，也不得反向引入框架实现。
 */

import type { ContractCheck, ExtensionPointId } from '@domain/plugin/types';

/** 一次确定性试算用例 */
export interface ExtensionPointTrialCase {
  /** 直接传给沙箱的原始输入，宿主不解读 */
  input: unknown;
  /** 用例标签（失败诊断与观察文本用） */
  label: string;
  /** 期望输出；undefined 表示该用例只验输出契约、不做值比对 */
  expect?: unknown;
}

/** 构造试算用例时的上下文：模型 / 资源给的数据，宿主不解读语义 */
export interface ExtensionPointTrialContext {
  /** 自定义试算输入；undefined = 用行为自带的代表性样例 */
  customInput?: unknown;
  /** 资源契约（由行为自己解读，例如方法白名单 + 自检样例） */
  contract?: unknown;
}

export type TrialCaseBuildResult =
  | { ok: true; cases: ExtensionPointTrialCase[]; usedCustomInput: boolean }
  | { ok: false; reason: string };

/** 自定义试算输入在工具参数里的声明（纯数据，不是分派逻辑） */
export interface ExtensionPointTrialInput {
  /** 参数名，例如 ranking 的 "matches" */
  readonly param: string;
  /** 该参数的 JSON Schema */
  readonly schema: Record<string, unknown>;
}

/** 框架与一个扩展点之间的唯一契约 */
export interface ExtensionPointBehavior {
  readonly pointId: ExtensionPointId;
  /** 扩展点中文标签，用于 system prompt 分节与诊断 */
  readonly label: string;
  /** 试算结果标签（观察文本里的「…」） */
  readonly resultLabel: string;
  /** 修订 / 回滚观察里的「本版 …」标签 */
  readonly revisionResultLabel: string;
  /** 写进 system prompt 的沙箱契约说明 */
  readonly contractLines: string;
  /** plugin_apply 是否允许把该扩展点的工件设为页面当前口径 */
  readonly supportsApplySelection: boolean;
  /** 工具参数里 pointId 的说明（由行为提供，框架不写死任何扩展点） */
  readonly pointIdDescription: string;
  /** 自定义试算输入声明；undefined = 该扩展点不接受自定义输入 */
  readonly trialInput?: ExtensionPointTrialInput;
  /** 该扩展点在 plugin_write / plugin_debug 里额外需要的参数 JSON Schema */
  readonly extraParams?: Readonly<Record<string, Record<string, unknown>>>;

  /** 构造本次试算的全部用例（含自定义输入解析与资源契约校验） */
  buildTrialCases(ctx: ExtensionPointTrialContext): TrialCaseBuildResult;
  /** 输出契约校验：纯函数，口径由扩展点行为提供 */
  validateOutput(output: unknown, input: unknown): ContractCheck;
  /** 契约失败时回喂 LLM 的人话诊断（业务文案由行为提供） */
  contractHint(check: ContractCheck): string;
  /** 试算结果 → 回填给模型的观察文本 */
  formatResult(outputs: readonly unknown[], cases: readonly ExtensionPointTrialCase[]): string;
  /** 试算输入范围说明（观察文本用） */
  trialScopeLabel(usedCustomInput: boolean): string;
  /** 用例期望值比对；不提供则不比对 */
  matchesExpect?(actual: unknown, expected: unknown): boolean;
  /** 从工具参数里读取资源契约（宿主不解读形状） */
  parseContract?(args: Record<string, unknown>): unknown;
  /** 资源契约快筛：返回第一条人话错误，合法返回 undefined */
  validateContract?(contract: unknown): string | undefined;
  /** 试算通过后随工件持久化的资源契约；undefined = 该扩展点不持久化契约 */
  artifactContract?(ctx: ExtensionPointTrialContext): unknown;
}

/** 按 pointId 查表的注册表；装配根注入，框架各处只读 */
export type ExtensionPointBehaviorRegistry = Readonly<Record<string, ExtensionPointBehavior>>;

/** 按 pointId 取行为；未注册返回 undefined，调用方据此给出明确失败观察 */
export function resolveExtensionPointBehavior(
  registry: ExtensionPointBehaviorRegistry,
  pointId: ExtensionPointId,
): ExtensionPointBehavior | undefined {
  return registry[pointId];
}
