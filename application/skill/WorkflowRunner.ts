/**
 * 阶段二 workflow DAG runner：按声明顺序跑算子链，失败短路，结构化回灌。
 * @module application/skill/WorkflowRunner
 *
 * 语义出处：PHASE2-CONTRACT.md「DSL 语义条款」/「DSL 字段形状」/「runner 语义」/
 * 「URL 模板」，以及设计稿 L1574–1657 / L1852–1900。
 *
 * 封闭载体（条款 1）：连线只认上游 `StepResult.value`；effects 走既有宿主通道、
 * 不参与连线。runner 只做「按名执行 + 引用取值 + 累积 + 短路」，不重写任何算子。
 *
 * 边界（逐条可查，不引入任何新常数）：
 * - 步骤数 N = `spec.steps.length`（静态声明长度，解析期有限可知）；
 * - 无环：`bindings[].from` 在解析期（E 的 parseSkillRecipe）已验「指向更前」，
 *   runner 不再做拓扑排序，steps 数组顺序即拓扑序；
 * - 无表达式 / 无条件 / 无循环：`{{input.xxx}}` 是**数据注入**（PHASE2-CONTRACT
 *   「URL 模板 / 占位符」+ 主代理增量校正）：规则① 字符串完整等于占位符 → 按
 *   inputs[].type 注入**原始值**（不 String()）；规则② 字符串内嵌 → 逐字 String() 替换。
 *   不是 eval、不拼表达式、不递归展开替换结果、不引入转义/数值规则（条款 2）；
 * - 失败即短路 + 结构化错误（哪个节点 / 什么错 / 已完成节点列表），**宿主不自动重试**；
 * - 仅 `yield:true` 节点的 value 进结果汇总（进模型上下文用）；
 * - 不引入重试次数 / 超时 / 步数上限：确定性部分不消耗决策预算，
 *   模型驱动的多轮由既有 maxTurns 管住。
 *
 * 取证确认（勿指望阶段一地基）：`OperatorRegistry.run()` 在「名字未注册」与
 * 「插件执行失败」两条路径都只抛普通 Error（OperatorRegistry.ts），阶段一没有
 * 结构化失败对象、不填 meta。故 runner 自己 try/catch 每个节点并包装。
 *
 * 依赖环：本文件只 type-import `SkillTypes` / `domain/plugin/types` /
 * `OperatorRegistry`，不 import 任何原语实现或 ToolLoop/ChatUseCase，
 * 不产生新依赖环。binding.path 的取值用 runner 内自带的**简单点路径**读取器
 * （`a.b[0].c` / `$`），故意不复用 json_extract 的完整路径引擎：
 * 那属于算子能力（`[*]` / `..name` / where...），runner 只做「引用取值」，
 * 保持契约「runner 不重写算子 / 极窄 DSL」的边界。
 */

import type { PluginTraceStep, StepResult } from '@domain/plugin/types';
import type { OperatorRegistry } from '@application/plugin/OperatorRegistry';
import type {
  WorkflowSpec, WorkflowStep, WorkflowInput,
} from '@application/skill/SkillTypes';

/** 与 StepResult.effects 同形；runner 全量累积，不取最后一个、不覆盖。 */
export type WorkflowEffect = { displayMarkdown?: string; actionLink?: string };

/** 失败时的结构化信息：哪个 step id / 错误 / 已完成 step id 列表。 */
export interface WorkflowFailure {
  /** 出错的 step id；inputs 校验阶段失败时为 '<inputs>' 哨兵（无具体节点）。 */
  stepId: string;
  /** 人话 + 结构化错误文本（供模型兜底表达，不回灌裸 Error）。 */
  error: string;
  /** 出错前已完成的 step id 列表（按执行顺序）；短路后的节点不在其中。 */
  completedStepIds: string[];
}

export interface WorkflowRunResult {
  ok: boolean;
  /** 仅 yield:true 节点的 value，按 step id 汇总（进模型上下文用）。 */
  values: Record<string, unknown>;
  /** 全部节点累积的 effects（不覆盖、不取最后一个）。 */
  effects: WorkflowEffect[];
  /** 已完成的 step id 列表（成功 = 全部；失败 = 出错前已完成部分）。 */
  completedStepIds: string[];
  /** 失败时的结构化信息；成功时省略。 */
  failure?: WorkflowFailure;
}

/** inputs 校验哨兵：失败发生在任何节点之前，没有真实 step id 可报。 */
const INPUTS_STEP_ID = '<inputs>';

/**
 * 占位符 `{{input.xxx}}` 的两种形态（PHASE2-CONTRACT「URL 模板 / 占位符」，
 * 主代理 10:xx 增量校正优先于旧措辞）：
 * - 规则①：字符串**完整等于** `{{input.xxx}}` → 按 inputs[].type 注入**原始值**
 *   （integer/number/boolean/object/array 保持类型，**不 String()**）。
 *   月历 `{"year":"{{input.year}}"}`、`display` 的 `{"fields":"{{input.fields}}"}` 靠这条；
 *   否则 `lunar.monthCalendar` 会因为 year 变字符串校验失败、`display_json_list` 会因为
 *   fields 变字符串报错。
 * - 规则②：字符串**内嵌** `{{input.xxx}}` → 逐字 `String()` 替换（URL 里的 page/tag/pagesize）。
 *   不 eval、不拼接表达式、不递归、不引入转义/数值规则。这是数据注入，不是 DSL 表达式。
 * 配方是严格 JSON，占位符只能是字符串值；裸 `{{...}}` 非合法 JSON、禁用。
 */
const WHOLE_PLACEHOLDER_RE = /^\{\{input\.([^{}]+)\}\}$/;
const EMBEDDED_PLACEHOLDER_RE = /\{\{input\.([^{}]+)\}\}/g;

/** 属性访问只认自身属性，并挡住原型链上的危险键（与宿主其余取值层同口径）。 */
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** 过程块：契约明确 source='web' / attempt=1 / phase='observe'（非来路不明常数）。 */
function traceStep(ok: boolean, detail: string): PluginTraceStep {
  return { source: 'web', attempt: 1, phase: 'observe', ok, detail };
}

/** 与 ToolLoop.push 同口径：纯展示失败不影响主流程。 */
function pushTrace(
  onTrace: ((s: PluginTraceStep) => void) | undefined,
  ok: boolean,
  detail: string,
): void {
  if (!onTrace) return;
  try { onTrace(traceStep(ok, detail)); } catch { /* 纯展示，单步失败不影响主流程 */ }
}

// ---------------------------------------------------------------- inputs 合并

/** 基本形状校验（契约：integer 用 Number.isInteger）。 */
function shapeMatches(type: WorkflowInput['type'], v: unknown): boolean {
  switch (type) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number';
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'object': return typeof v === 'object' && v !== null && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    default: return false;
  }
}

/** enum 是配方数据，宿主只做校验；对象/数组用 JSON 形态比较，标量用 ===。 */
function enumContains(values: readonly unknown[], v: unknown): boolean {
  return values.some((e) => {
    if (e === v) return true;
    if (e !== null && typeof e === 'object' && v !== null && typeof v === 'object') {
      return JSON.stringify(e) === JSON.stringify(v);
    }
    return false;
  });
}

/**
 * 解析 inputs 契约 → 实际值表。
 * - 模型给了就用模型值；没给且有 default 用 default；没给、无 default、required:true → 失败；
 * - required:false 且两者都无 → 不注入该键（不塞 undefined，避免污染 args）；
 * - type / enum 逐项校验，失败给结构化错误文本。
 */
function resolveInputs(
  decls: readonly WorkflowInput[] | undefined,
  inputs: Record<string, unknown>,
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};
  for (const decl of decls ?? []) {
    const provided = Object.prototype.hasOwnProperty.call(inputs, decl.name);
    const value = provided ? inputs[decl.name] : decl.default;
    if (value === undefined) {
      if (decl.required === true) {
        return { ok: false, error: `必填参数「${decl.name}」未提供且配方无缺省值` };
      }
      continue;
    }
    if (!shapeMatches(decl.type, value)) {
      return { ok: false, error: `参数「${decl.name}」形状不符：要求 ${decl.type}，实际 ${typeof value}` };
    }
    if (decl.enum !== undefined && !enumContains(decl.enum, value)) {
      return { ok: false, error: `参数「${decl.name}」取值不在配方声明的 enum 内` };
    }
    out[decl.name] = value;
  }
  return { ok: true, values: out };
}

/**
 * 把 args 里的 `{{input.xxx}}` 占位符解析成实际值（数据注入，不是表达式求值）。
 * 遍历所有叶子（配方可能把占位符写在嵌套结构里）：
 * - 规则①：整个字符串恰为一个占位符 → 返回**原始类型值**（不 String()）；
 * - 规则②：字符串内嵌占位符 → 逐字 `String()` 替换，替换结果**不递归再展开**；
 * - 无占位符的字符串 / 其它标量原样返回。
 * inputs 只经占位符注入（配方写哪里就注哪里），不 blanket 塞进每个节点的 args。
 */
function substituteInputs(
  node: unknown,
  resolved: Record<string, unknown>,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof node === 'string') {
    const whole = WHOLE_PLACEHOLDER_RE.exec(node);
    if (whole) {
      const name = whole[1]!;
      if (!Object.prototype.hasOwnProperty.call(resolved, name)) {
        return { ok: false, error: `占位符 {{input.${name}}} 没有对应的已解析 input` };
      }
      // 规则①：注入原始值。resolved 里的值已过 resolveInputs 的 type/enum 校验，
      // 保 integer(number)/array/object/boolean/string 原类型，绝不能 String()。
      return { ok: true, value: resolved[name] };
    }
    // 规则②：内嵌占位符逐字 String() 替换（只用于 URL 这类文本）。
    let missing = '';
    const replaced = node.replace(EMBEDDED_PLACEHOLDER_RE, (_whole, name: string) => {
      if (!Object.prototype.hasOwnProperty.call(resolved, name)) {
        missing = name;
        return _whole;
      }
      return String(resolved[name]);
    });
    return missing
      ? { ok: false, error: `占位符 {{input.${missing}}} 没有对应的已解析 input` }
      : { ok: true, value: replaced };
  }
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const item of node) {
      const r = substituteInputs(item, resolved);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const r = substituteInputs(v, resolved);
      if (!r.ok) return r;
      out[k] = r.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value: node };
}

// ---------------------------------------------------------------- binding 引用取值

type PathToken = { kind: 'key'; name: string } | { kind: 'index'; n: number };

/** 简单点路径解析：`a.b[0].c` / `$` / 可选 `["含点键"]` / 负下标。 */
function parseSimplePath(path: string): PathToken[] | null {
  const s = path.trim();
  let i = 0;
  if (s.startsWith('$')) {
    i = 1;
    if (s.charAt(i) === '.') i++;
  }
  const tokens: PathToken[] = [];
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '.') { i++; continue; }
    if (c === '[') {
      const close = s.indexOf(']', i + 1);
      if (close < 0) return null;
      const inner = s.slice(i + 1, close).trim();
      if (/^-?\d+$/.test(inner)) {
        tokens.push({ kind: 'index', n: Number(inner) });
      } else if (inner.startsWith('"') && inner.endsWith('"')) {
        try { tokens.push({ kind: 'key', name: JSON.parse(inner) as string }); } catch { return null; }
      } else {
        return null;
      }
      i = close + 1;
    } else {
      let j = i;
      while (j < s.length && s.charAt(j) !== '.' && s.charAt(j) !== '[') j++;
      const name = s.slice(i, j).trim();
      if (!name) return null;
      tokens.push({ kind: 'key', name });
      i = j;
    }
  }
  return tokens;
}

/**
 * 从上游 StepResult.value 按 path 取值。`'$'`（或空串）取整个 value。
 * 取不到值 → 结构化失败（不静默继续、不注入 undefined）。
 */
function readBindingValue(
  root: unknown,
  path: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (path === '' || path === '$') return { ok: true, value: root };
  const tokens = parseSimplePath(path);
  if (!tokens || tokens.length === 0) {
    return { ok: false, error: `引用路径「${path}」无法解析` };
  }
  let cur: unknown = root;
  for (const t of tokens) {
    if (t.kind === 'key') {
      if (DANGEROUS_KEYS.has(t.name) || cur === null || typeof cur !== 'object'
        || Array.isArray(cur)
        || !Object.prototype.hasOwnProperty.call(cur, t.name)) {
        return { ok: false, error: `引用路径「${path}」在键「${t.name}」处取不到值` };
      }
      cur = (cur as Record<string, unknown>)[t.name];
    } else {
      if (!Array.isArray(cur)) {
        return { ok: false, error: `引用路径「${path}」在下标「${t.n}」处不是数组` };
      }
      const n = t.n < 0 ? cur.length + t.n : t.n;
      if (!Number.isInteger(n) || n < 0 || n >= cur.length) {
        return { ok: false, error: `引用路径「${path}」在下标「${t.n}」处越界` };
      }
      cur = cur[n];
    }
  }
  if (cur === undefined) {
    return { ok: false, error: `引用路径「${path}」取不到值（结果为 undefined）` };
  }
  return { ok: true, value: cur };
}

// ---------------------------------------------------------------- 主流程

/**
 * 跑一条 workflow 声明。
 *
 * 签名按契约 4 参；第 5 个可选参数 `inputDecls` 是 `SkillRecipe.inputs`：
 * E 的 `WorkflowSpec` 只有 `steps`，而契约要求 runner 做
 * default / required / enum / type 校验，声明表只能由调用方（WorkflowTool）
 * 从整条 SkillRecipe 透传。不传时跳过契约校验（仍做占位符替换与值合并），
 * 4 参调用与契约签名逐字兼容。
 */
export async function runWorkflow(
  spec: WorkflowSpec,
  inputs: Record<string, unknown>,
  registry: OperatorRegistry,
  onTrace?: (s: PluginTraceStep) => void,
  inputDecls?: readonly WorkflowInput[],
): Promise<WorkflowRunResult> {
  const steps: readonly WorkflowStep[] = spec.steps ?? [];
  const N = steps.length; // 步骤数 = 静态声明长度，零新常数

  // 开头即显示「共 N 步」：声明静态，进度感从第一刻完整（条款 8）。
  // phase='observe' 让 ChatUseCase 的实时过程块懒建立即点亮。
  pushTrace(onTrace, true, `workflow 共 ${N} 步`);

  const completedStepIds: string[] = [];
  const effects: WorkflowEffect[] = [];
  const values: Record<string, unknown> = {};

  const fail = (stepId: string, error: string, detail: string): WorkflowRunResult => {
    pushTrace(onTrace, false, detail);
    return {
      ok: false,
      values,
      effects,
      completedStepIds: [...completedStepIds],
      failure: { stepId, error, completedStepIds: [...completedStepIds] },
    };
  };

  // 运行前防御（一次）：解析期已验无环/引用真实/唯一 id，这里只补「算子是否真的注册」。
  // 未命中即拒跑，不执行任何节点（避免跑了一半才发现白名单没命中）。
  for (const step of steps) {
    if (registry.get(step.call) === undefined) {
      return fail(step.id, `未注册算子:${step.call}`,
        `workflow 运行前校验失败：节点 ${step.id} 引用了未注册算子 ${step.call}`);
    }
  }

  // inputs 契约校验 / 缺省填充。失败发生在任何节点之前，stepId 用哨兵。
  const resolved = resolveInputs(inputDecls, inputs);
  if (!resolved.ok) {
    return fail(INPUTS_STEP_ID, resolved.error, `workflow 参数校验失败：${resolved.error}`);
  }
  const resolvedInputs = resolved.values;

  // 上游 value 表：step id → StepResult.value（连线只认 value）。
  const upstream = new Map<string, unknown>();

  for (let k = 0; k < N; k++) {
    const step = steps[k]!;
    const kth = k + 1;

    // 合并顺序：字面量 args（占位符按规则①/②注入 inputs 原值/文本）
    // → bindings 从上游 value 覆写注入。inputs 只经配方里写明的占位符进入，
    // 不 blanket 塞进每个节点（G 的 web_fetch 不该收到 year/page 等无关键）。
    const literal = substituteInputs(step.args ?? {}, resolvedInputs);
    if (!literal.ok) {
      return fail(step.id, literal.error, `第 ${kth}/${N} 步 ${step.call} 参数失败：${literal.error}`);
    }
    const mergedArgs: Record<string, unknown> = {
      ...(literal.value as Record<string, unknown>),
    };
    for (const binding of step.bindings ?? []) {
      const source = upstream.get(binding.from);
      if (!upstream.has(binding.from)) {
        return fail(step.id,
          `节点 ${binding.from} 尚无 value（bindings.from 必须指向更靠前的已完成节点）`,
          `第 ${kth}/${N} 步 ${step.call} 引用失败：上游 ${binding.from} 无 value`);
      }
      const got = readBindingValue(source, binding.path);
      if (!got.ok) {
        return fail(step.id, got.error,
          `第 ${kth}/${N} 步 ${step.call} 引用失败：${got.error}`);
      }
      mergedArgs[binding.as] = got.value;
    }

    // 执行：OperatorRegistry.run 只抛普通 Error，runner 自己包装成结构化失败。
    let result: StepResult;
    try {
      result = await registry.run(step.call, mergedArgs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return fail(step.id, reason, `第 ${kth}/${N} 步 ${step.call} 失败：${reason}`);
    }

    // effects 全量累积（不覆盖、不取最后一个；插件节点天然无 effects）。
    for (const e of result.effects ?? []) effects.push(e);
    // 记录 value 供下游 binding；仅显式 yield:true 的节点进模型上下文汇总。
    upstream.set(step.id, result.value);
    if (step.yield === true) values[step.id] = result.value;
    completedStepIds.push(step.id);

    pushTrace(onTrace, true, `第 ${kth}/${N} 步 ${step.call} 完成`);
  }

  return { ok: true, values, effects, completedStepIds };
}
