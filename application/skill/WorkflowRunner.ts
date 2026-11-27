/**
 * 阶段二 workflow runner：按声明顺序执行算子链与通用循环控制块，失败短路，结构化回灌。
 * @module application/skill/WorkflowRunner
 *
 * 语义出处：PHASE2-CONTRACT.md「DSL 语义条款」/「DSL 字段形状」/「runner 语义」/
 * 「URL 模板」，以及设计稿 L1574–1657 / L1852–1900。
 *
 * 封闭载体（条款 1）：连线只认上游 `StepResult.value`；effects 走既有宿主通道、
 * 不参与连线。runner 只做「按名执行 + 引用取值 + 累积 + 短路」，不重写任何算子。
 *
 * 边界（逐条可查，不引入任何新常数）：
 * - 普通节点按 steps 声明顺序执行；forEach / repeat / ifElse 是 runner 原生控制块，循环体仍只调用已注册算子；
 * - `bindings[].from` 在解析期验为更靠前的节点；循环体拥有独立局部节点作用域，可读取外层已完成节点；
 * - 不执行表达式或动态代码：`{{input.xxx}}`、`{{item.path}}`、`{{index}}`、`{{state.path}}` 都是受限数据注入；
 * - 失败即短路 + 结构化错误（哪个节点 / 什么错 / 已完成节点列表），**宿主不自动重试**；
 * - 仅 `yield:true` 节点的 value 进结果汇总（宿主内部保留；成功观察只回完成+句柄，不回灌模型）；
 * - repeat 与 forEach 受 MAX_WORKFLOW_ITERATIONS 资源上限保护；循环体由宿主确定性调度，不消耗模型决策轮。
 *
 * 取证确认（勿指望阶段一地基）：`OperatorRegistry.run()` 在「名字未注册」与
 * 「插件执行失败」两条路径都只抛普通 Error（OperatorRegistry.ts），阶段一没有
 * 结构化失败对象、不填 meta。故 runner 自己 try/catch 每个节点并包装。
 *
 * 依赖环：本文件只 type-import `SkillTypes` / `domain/plugin/types` /
 * `OperatorRegistry`，不 import 任何原语实现或 ToolLoop/ChatUseCase，
 * 不产生新依赖环。binding.path 的取值用 runner 内自带的**简单点路径**读取器
 * （`a.b[0].c` / `$`），故意不复用 JSON 沙箱算子 的完整路径引擎：
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
  /**
   * 调试模式专用：每一步的实际入参 / 输出 value / 本步 effects / 成功或失败。
   * 只有调用方传 captureTrace:true 时才填充；正常模式不产生（零额外开销）。
   * 不进宿主旁路、不落历史，仅供 ToolOutcome.observation 结构化回灌模型。
   */
  stepTrace?: WorkflowStepTrace[];
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
 *   `display` 的 `{"fields":"{{input.fields}}"}` 靠这条：否则 fields
 *   变字符串会报错（数组类参数必须保原始类型）。
 * - 规则②：字符串**内嵌** `{{input.xxx}}` → 逐字 `String()` 替换（URL 里的 page/tag/pagesize）。
 *   不 eval、不拼接表达式、不递归、不引入转义/数值规则。这是数据注入，不是 DSL 表达式。
 * 配方是严格 JSON，占位符只能是字符串值；裸 `{{...}}` 非合法 JSON、禁用。
 */
const WHOLE_PLACEHOLDER_RE = /^\{\{input\.([^{}]+)\}\}$/;
const EMBEDDED_PLACEHOLDER_RE = /\{\{(?:input\.[^{}]+|item(?:\.[^{}]+)?|index|state(?:\.[^{}]+)?|urlencode\.(?:input\.[^{}]+|item(?:\.[^{}]+)?|state(?:\.[^{}]+)?))\}\}/g;
const SCOPE_PLACEHOLDER_RE = /^\{\{(item(?:\.[^{}]+)?|index|state(?:\.[^{}]+)?)\}\}$/;
const URL_ENCODE_PLACEHOLDER_RE = /^\{\{urlencode\.(input\.[^{}]+|item(?:\.[^{}]+)?|state(?:\.[^{}]+)?)\}\}$/;
const MAX_WORKFLOW_ITERATIONS = 100;
const MAX_WORKFLOW_TOTAL_ITERATIONS = 500;

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
 * 把 args 里的 input/item/index/state 占位符解析成实际值（数据注入，不是表达式求值）。
 * 遍历所有叶子（配方可能把占位符写在嵌套结构里）：
 * - 规则①：整个字符串恰为一个占位符 → 返回**原始类型值**（不 String()）；
 * - 规则②：字符串内嵌占位符 → 逐字 `String()` 替换，替换结果**不递归再展开**；
 * - 无占位符的字符串 / 其它标量原样返回。
 * inputs 与循环作用域只经占位符注入（配方写哪里就注哪里），不 blanket 塞进每个节点的 args。
 */
interface WorkflowTemplateScope {
  item?: unknown;
  index?: number;
  state?: unknown;
}

function resolveScopePlaceholder(
  token: string,
  scope: WorkflowTemplateScope | undefined,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (token === 'index') {
    return scope?.index === undefined
      ? { ok: false, error: '占位符 {{index}} 只能在 forEach 循环体内使用' }
      : { ok: true, value: scope.index };
  }
  const dot = token.indexOf('.');
  const rootName = dot < 0 ? token : token.slice(0, dot);
  const path = dot < 0 ? '$' : token.slice(dot + 1);
  const root = rootName === 'item' ? scope?.item : scope?.state;
  if (root === undefined) {
    return { ok: false, error: '占位符 {{' + token + '}} 不在对应循环作用域内' };
  }
  const got = readBindingValue(root, path);
  return got.ok ? got : { ok: false, error: '占位符 {{' + token + '}}：' + got.error };
}

function resolveUrlEncodePlaceholder(
  token: string,
  resolved: Record<string, unknown>,
  scope: WorkflowTemplateScope | undefined,
): { ok: true; value: string } | { ok: false; error: string } {
  const match = /^urlencode\.(input\.([^{}]+)|item(?:\.[^{}]+)?|state(?:\.[^{}]+)?)$/.exec(token);
  if (!match) return { ok: false, error: 'URL 编码占位符格式无效：{{' + token + '}}' };
  let value: unknown;
  if (match[2] !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(resolved, match[2])) {
      return { ok: false, error: '占位符 {{urlencode.input.' + match[2] + '}} 没有对应的已解析 input' };
    }
    value = resolved[match[2]];
  } else {
    const got = resolveScopePlaceholder(match[1]!, scope);
    if (!got.ok) return got;
    value = got.value;
  }
  if (value === null || value === undefined || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) {
    return { ok: false, error: 'URL 编码占位符只接受字符串、数字或布尔值' };
  }
  return { ok: true, value: encodeURIComponent(String(value)) };
}

function substituteInputs(
  node: unknown,
  resolved: Record<string, unknown>,
  scope?: WorkflowTemplateScope,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof node === 'string') {
    const encodedWhole = URL_ENCODE_PLACEHOLDER_RE.exec(node);
    if (encodedWhole) return resolveUrlEncodePlaceholder(encodedWhole[0].slice(2, -2), resolved, scope);
    const whole = WHOLE_PLACEHOLDER_RE.exec(node);
    if (whole) {
      const name = whole[1]!;
      if (!Object.prototype.hasOwnProperty.call(resolved, name)) {
        return { ok: false, error: '占位符 {{input.' + name + '}} 没有对应的已解析 input' };
      }
      return { ok: true, value: resolved[name] };
    }
    const scopeWhole = SCOPE_PLACEHOLDER_RE.exec(node);
    if (scopeWhole) return resolveScopePlaceholder(scopeWhole[1]!, scope);
    let failure: string | undefined;
    const replaced = node.replace(EMBEDDED_PLACEHOLDER_RE, (token) => {
      const encoded = /^\{\{urlencode\.([^{}]+)\}\}$/.exec(token);
      if (encoded) {
        const got = resolveUrlEncodePlaceholder('urlencode.' + encoded[1]!, resolved, scope);
        if (!got.ok) { failure = got.error; return token; }
        return got.value;
      }
      const input = /^\{\{input\.([^{}]+)\}\}$/.exec(token);
      if (input) {
        const name = input[1]!;
        if (!Object.prototype.hasOwnProperty.call(resolved, name)) {
          failure = '占位符 {{input.' + name + '}} 没有对应的已解析 input';
          return token;
        }
        return String(resolved[name]);
      }
      const scoped = /^\{\{([^{}]+)\}\}$/.exec(token);
      if (!scoped) return token;
      const got = resolveScopePlaceholder(scoped[1]!, scope);
      if (!got.ok) { failure = got.error; return token; }
      return String(got.value);
    });
    return failure ? { ok: false, error: failure } : { ok: true, value: replaced };
  }
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const item of node) {
      const r = substituteInputs(item, resolved, scope);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const r = substituteInputs(v, resolved, scope);
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
  captureTrace = false,
): Promise<WorkflowRunResult> {
  const steps: readonly WorkflowStep[] = spec.steps ?? [];
  const completedStepIds: string[] = [];
  const effects: WorkflowEffect[] = [];
  const values: Record<string, unknown> = {};
  const stepTrace: WorkflowStepTrace[] | undefined = captureTrace ? [] : undefined;

  const fail = (stepId: string, error: string, detail: string): WorkflowRunResult => {
    pushTrace(onTrace, false, detail);
    return {
      ok: false, values, effects, completedStepIds: [...completedStepIds],
      ...(stepTrace !== undefined ? { stepTrace } : {}),
      failure: { stepId, error, completedStepIds: [...completedStepIds] },
    };
  };

  const missingOperator = (items: readonly WorkflowStep[], prefix: string): { id: string; call: string } | undefined => {
    for (const step of items) {
      const path = prefix + step.id;
      if (step.call !== undefined) {
        if (registry.get(step.call) === undefined) return { id: path, call: step.call };
      } else {
        const nested = step.forEach?.steps ?? step.repeat?.steps ?? [];
        const missing = missingOperator(nested, path + "/");
        if (missing) return missing;
        if (step.ifElse !== undefined) {
          const thenMissing = missingOperator(step.ifElse.then, path + "/then/");
          if (thenMissing) return thenMissing;
          const elseMissing = missingOperator(step.ifElse.else ?? [], path + "/else/");
          if (elseMissing) return elseMissing;
        }
      }
    }
    return undefined;
  };
  const missing = missingOperator(steps, "");
  if (missing) {
    const reason = `未注册算子:${missing.call}`;
    stepTrace?.push({ stepId: missing.id, call: missing.call, args: {}, ok: false, effects: [], error: reason });
    return fail(missing.id, reason, `workflow 运行前校验失败：节点 ${missing.id} 引用了未注册算子 ${missing.call}`);
  }

  const resolved = resolveInputs(inputDecls, inputs);
  if (!resolved.ok) {
    stepTrace?.push({
      stepId: INPUTS_STEP_ID, call: '<inputs>', args: inputs,
      ok: false, error: resolved.error, effects: [],
    });
    return fail(INPUTS_STEP_ID, resolved.error, `workflow 参数校验失败：${resolved.error}`);
  }
  const resolvedInputs = resolved.values;

  let totalLoopIterations = 0;
  type Scope = WorkflowTemplateScope;
  type InternalResult =
    | { ok: true; lastValue: unknown }
    | { ok: false; stepId: string; error: string; detail: string };

  const runSteps = async (
    items: readonly WorkflowStep[],
    upstream: Map<string, unknown>,
    scope: Scope,
    prefix: string,
    collectYield: boolean,
  ): Promise<InternalResult> => {
    let lastValue: unknown = null;
    for (const step of items) {
      const stepId = prefix + step.id;
      const callName = step.call ?? (step.forEach ? '<forEach>' : step.repeat ? '<repeat>' : '<ifElse>');

      if (step.call !== undefined) {
        const literal = substituteInputs(step.args ?? {}, resolvedInputs, scope);
        if (!literal.ok) return { ok: false, stepId, error: literal.error, detail: `节点 ${stepId} 参数失败：${literal.error}` };
        const mergedArgs: Record<string, unknown> = { ...(literal.value as Record<string, unknown>) };
        for (const binding of step.bindings ?? []) {
          if (!upstream.has(binding.from)) {
            const reason = `节点 ${binding.from} 尚无 value（bindings.from 必须指向更靠前的已完成节点）`;
            return { ok: false, stepId, error: reason, detail: `节点 ${stepId} 引用失败：上游 ${binding.from} 无 value` };
          }
          const got = readBindingValue(upstream.get(binding.from), binding.path);
          if (!got.ok) return { ok: false, stepId, error: got.error, detail: `节点 ${stepId} 引用失败：${got.error}` };
          mergedArgs[binding.as] = got.value;
        }
        let result: StepResult;
        try {
          result = await registry.run(step.call, mergedArgs);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return { ok: false, stepId, error: reason, detail: `节点 ${stepId} ${step.call} 失败：${reason}` };
        }
        const stepEffects: WorkflowEffect[] = [];
        for (const effect of result.effects ?? []) {
          effects.push(effect);
          stepEffects.push(effect);
        }
        upstream.set(step.id, result.value);
        lastValue = result.value;
        if (collectYield && step.yield === true) values[step.id] = result.value;
        completedStepIds.push(stepId);
        stepTrace?.push({ stepId, call: step.call, args: mergedArgs, value: result.value, effects: stepEffects, ok: true });
        pushTrace(onTrace, true, `节点 ${stepId} ${step.call} 完成`);
        continue;
      }

      if (step.forEach !== undefined) {
        if (!upstream.has(step.forEach.from)) {
          return { ok: false, stepId, error: `forEach 来源节点无 value：${step.forEach.from}`, detail: `节点 ${stepId} 无法读取循环数组` };
        }
        const source = readBindingValue(upstream.get(step.forEach.from), step.forEach.path);
        if (!source.ok) return { ok: false, stepId, error: source.error, detail: `节点 ${stepId} 循环来源路径失败：${source.error}` };
        if (!Array.isArray(source.value)) return { ok: false, stepId, error: 'forEach 来源必须是数组', detail: `节点 ${stepId} 循环来源不是数组` };
        if (source.value.length > MAX_WORKFLOW_ITERATIONS) {
          return { ok: false, stepId, error: `forEach 项数超过宿主上限 ${MAX_WORKFLOW_ITERATIONS}`, detail: `节点 ${stepId} 循环项数超限` };
        }
        const results: unknown[] = [];
        for (let index = 0; index < source.value.length; index++) {
          if (totalLoopIterations >= MAX_WORKFLOW_TOTAL_ITERATIONS) {
            return { ok: false, stepId, error: `Workflow 累计循环次数超过宿主上限 ${MAX_WORKFLOW_TOTAL_ITERATIONS}`, detail: `节点 ${stepId} 累计循环预算耗尽` };
          }
          totalLoopIterations += 1;
          const local = new Map(upstream);
          const nested = await runSteps(
            step.forEach.steps, local, { ...scope, item: source.value[index], index },
            `${stepId}[${index}]/`, false,
          );
          if (!nested.ok) {
            if (step.forEach.onError !== 'continue') return nested;
            results.push({
              ok: false,
              error: { stepId: nested.stepId, message: nested.error },
            });
            continue;
          }
          results.push(step.forEach.onError === 'continue'
            ? { ok: true, value: nested.lastValue }
            : nested.lastValue);
        }
        upstream.set(step.id, results);
        lastValue = results;
        if (collectYield && step.yield === true) values[step.id] = results;
        completedStepIds.push(stepId);
        stepTrace?.push({ stepId, call: callName, args: { from: step.forEach.from, path: step.forEach.path }, value: results, effects: [], ok: true });
        pushTrace(onTrace, true, `节点 ${stepId} forEach 完成（${results.length} 项）`);
        continue;
      }

      if (step.ifElse !== undefined) {
        const condition = step.ifElse.condition;
        if (!upstream.has(condition.from)) {
          return { ok: false, stepId, error: `ifElse 条件来源节点无 value：${condition.from}`, detail: `节点 ${stepId} 无法读取分支条件` };
        }
        const conditionValue = readBindingValue(upstream.get(condition.from), condition.path);
        if (!conditionValue.ok) {
          return { ok: false, stepId, error: conditionValue.error, detail: `节点 ${stepId} 分支条件读取失败：${conditionValue.error}` };
        }
        if (typeof conditionValue.value !== 'boolean') {
          return { ok: false, stepId, error: 'ifElse.condition 必须指向 boolean 值', detail: `节点 ${stepId} 分支条件不是 boolean` };
        }
        const matched = conditionValue.value;
        const branchSteps = matched ? step.ifElse.then : (step.ifElse.else ?? []);
        const local = new Map(upstream);
        const nested = await runSteps(
          branchSteps, local, scope, `${stepId}.${matched ? 'then' : 'else'}/`, false,
        );
        if (!nested.ok) return nested;
        const branchResult = { condition: matched, value: nested.lastValue };
        upstream.set(step.id, branchResult);
        lastValue = branchResult;
        if (collectYield && step.yield === true) values[step.id] = branchResult;
        completedStepIds.push(stepId);
        stepTrace?.push({
          stepId, call: callName,
          args: { conditionFrom: condition.from, conditionPath: condition.path, matched },
          value: branchResult, effects: [], ok: true,
        });
        pushTrace(onTrace, true, `节点 ${stepId} if/else 完成（${matched ? 'then' : 'else'} 分支）`);
        continue;
      }

      const repeat = step.repeat!;
      const maxResult = substituteInputs(repeat.maxIterations, resolvedInputs, scope);
      if (!maxResult.ok) return { ok: false, stepId, error: maxResult.error, detail: `节点 ${stepId} 循环次数参数无效：${maxResult.error}` };
      const maxIterations = maxResult.value;
      if (typeof maxIterations !== 'number' || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_WORKFLOW_ITERATIONS) {
        const reason = `repeat.maxIterations 必须是 1 到 ${MAX_WORKFLOW_ITERATIONS} 之间的整数`;
        return { ok: false, stepId, error: reason, detail: `节点 ${stepId} 循环次数超出宿主允许范围` };
      }
      const initial = substituteInputs(repeat.initialState ?? {}, resolvedInputs, scope);
      if (!initial.ok) return { ok: false, stepId, error: initial.error, detail: `节点 ${stepId} 初始状态无效：${initial.error}` };
      if (!initial.value || typeof initial.value !== 'object' || Array.isArray(initial.value)) {
        return { ok: false, stepId, error: 'repeat.initialState 必须是对象', detail: `节点 ${stepId} 初始状态不是对象` };
      }
      let state: unknown = initial.value;
      const results: unknown[] = [];
      let stopped = false;
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (totalLoopIterations >= MAX_WORKFLOW_TOTAL_ITERATIONS) {
          return { ok: false, stepId, error: `Workflow 累计循环次数超过宿主上限 ${MAX_WORKFLOW_TOTAL_ITERATIONS}`, detail: `节点 ${stepId} 累计循环预算耗尽` };
        }
        totalLoopIterations += 1;
        const local = new Map(upstream);
        const nested = await runSteps(
          repeat.steps, local, { ...scope, state },
          `${stepId}[${iteration}]/`, false,
        );
        if (!nested.ok) return nested;
        results.push(nested.lastValue);
        const stateSource = local.get(repeat.stateFrom.from);
        const nextState = readBindingValue(stateSource, repeat.stateFrom.path);
        if (!nextState.ok) return { ok: false, stepId, error: nextState.error, detail: `节点 ${stepId} 更新循环状态失败：${nextState.error}` };
        if (!nextState.value || typeof nextState.value !== 'object' || Array.isArray(nextState.value)) {
          return { ok: false, stepId, error: 'repeat.stateFrom 必须指向对象状态', detail: `节点 ${stepId} 新状态不是对象` };
        }
        state = nextState.value;
        const untilSource = local.get(repeat.until.from);
        const untilValue = readBindingValue(untilSource, repeat.until.path);
        if (!untilValue.ok) return { ok: false, stepId, error: untilValue.error, detail: `节点 ${stepId} 停止条件读取失败：${untilValue.error}` };
        if (typeof untilValue.value !== 'boolean') {
          return { ok: false, stepId, error: 'repeat.until 必须指向 boolean 值', detail: `节点 ${stepId} 停止条件不是 boolean` };
        }
        if (untilValue.value) { stopped = true; break; }
      }
      const repeatResult = { items: results, state, stopped };
      upstream.set(step.id, repeatResult);
      lastValue = repeatResult;
      if (collectYield && step.yield === true) values[step.id] = repeatResult;
      completedStepIds.push(stepId);
      stepTrace?.push({ stepId, call: callName, args: { maxIterations }, value: repeatResult, effects: [], ok: true });
      pushTrace(onTrace, true, `节点 ${stepId} repeat 完成（${results.length} 轮，${stopped ? '已满足停止条件' : '达到轮数上限'}）`);
    }
    return { ok: true, lastValue };
  };

  pushTrace(onTrace, true, `workflow 共 ${steps.length} 个顶层步骤（循环由宿主调度）`);
  const upstream = new Map<string, unknown>();
  const execution = await runSteps(steps, upstream, {}, "", true);
  if (!execution.ok) return fail(execution.stepId, execution.error, execution.detail);
  return {
    ok: true, values, effects, completedStepIds,
    ...(stepTrace !== undefined ? { stepTrace } : {}),
  };
}

/**
 * 调试模式单步留痕。字段全部来自 runner 已有的真实数据，不新增业务计算：
 * - args：占位符替换 + bindings 注入后的**实际入参**（不是配方字面量）；
 * - value：本步算子的 .value（连线只认它）；yield:false 的节点也留；
 * - effects：本步产生的展示/动作旁路（与 WorkflowEffect 同形）；
 * - error：本步失败原因（成功时省略）。
 */
export interface WorkflowStepTrace {
  stepId: string;
  call: string;
  args: Record<string, unknown>;
  value?: unknown;
  effects: WorkflowEffect[];
  ok: boolean;
  error?: string;
}
