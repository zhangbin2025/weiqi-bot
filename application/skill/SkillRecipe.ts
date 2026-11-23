/**
 * 在线技能配方 / 清单的宽容解析与严格字段校验。
 * @module application/skill/SkillRecipe
 *
 * 边界：
 * - 只校验结构与取值，不查宿主注册表（原语是否存在由 SkillRegistry 决定）。
 * - 未知字段一律忽略（只读取已知字段、只构造已知字段）。
 * - 绝不执行配方里的任何内容：本文件只有类型判断与字符串处理。
 * - 失败时 reason 是中文可读原因，供上层静默回退内置技能。
 */

import type { SkillRecipe, SkillRegistryFile } from './SkillTypes';
import { parseSecretSpecs } from './SecretSpec';

/** 原语名即宿主注册表的固定 id：小写字母开头，只允许小写字母 / 数字 / 下划线。 */
const PRIMITIVE_NAME_RE = /^[a-z][a-z0-9_]*$/;

type FieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 必填非空字符串：纯空白也视为空，避免脏配方带空触发提示混进 system。 */
function readString(
  raw: Record<string, unknown>,
  key: string,
  label: string,
): FieldResult<string> {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, reason: `字段「${label}」必须是非空字符串` };
  }
  return { ok: true, value };
}

function readVersion(raw: Record<string, unknown>): FieldResult<number> {
  const value = raw['version'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { ok: false, reason: '字段「version」必须是正整数' };
  }
  return { ok: true, value };
}

function readPrimitives(raw: Record<string, unknown>): FieldResult<string[]> {
  const value = raw['primitives'];
  // 阶段二：带 workflow 声明的配方由节点 call 静态校验算子，primitives 允许为空数组
  // ——workflow 配方不挂散文原语工具，只由 run_workflow 并列触发（B 决策）。
  // 无 workflow 的散文配方仍必须至少 1 条原语，避免「既无原语又无 DAG」的空配方
  // 混进 system 提示；此条件只放宽「有 DAG 声明 + 空原语」这一组合。
  const workflowDeclared = raw['workflow'] !== undefined;
  if (!Array.isArray(value)) {
    return { ok: false, reason: '字段「primitives」必须是字符串数组' };
  }
  if (value.length === 0 && !workflowDeclared) {
    return { ok: false, reason: '字段「primitives」必须是至少包含 1 条的字符串数组' };
  }
  const items: readonly unknown[] = value;
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item: unknown = items[i];
    if (typeof item !== 'string' || !PRIMITIVE_NAME_RE.test(item)) {
      return { ok: false, reason: `字段「primitives」第 ${i + 1} 项必须匹配 /^[a-z][a-z0-9_]*$/` };
    }
    out.push(item);
  }
  return { ok: true, value: out };
}

/**
 * 可选 secrets：缺省表示不涉及凭据；显式给值时逐条过 parseSecretSpecs，
 * 结构/域名/头名不合规直接拒绝，绝不带着半份声明进运行时。
 */
/**
 * 可选 category：纯展示字段，宽松解析 —— 未知值/空串一律当缺省（走 id 兜底推导），
 * 绝不因为一个标签不认识就拒掉整条合法配方。
 */
function readCategory(raw: Record<string, unknown>): FieldResult<string | undefined> {
  const value = raw['category'];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' || !value.trim()) return { ok: true, value: undefined };
  return { ok: true, value: value.trim() };
}

function readSecrets(raw: Record<string, unknown>): FieldResult<SkillRecipe['secrets']> {
  if (raw['secrets'] === undefined) return { ok: true, value: undefined };
  try {
    return { ok: true, value: parseSecretSpecs(raw['secrets']) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// ---- 阶段二 workflow DSL 解析（workflow + inputs） ----
// 与模块既有「一个可选字段一个 readXxx，返回 FieldResult」约定一致：
// 命名入口 readWorkflow(raw) 解析 workflow / inputs 并返回两者；内部再拆成
// readWorkflowSpec / readWorkflowInputs 两个 reader，各自只校验一类声明。
// 全部是类型判断 / 字符串处理，绝不执行配方内容；零新增 import（含不依赖 OperatorRegistry）。
// 阶段二类型用索引访问从 SkillRecipe 派生，避免改动上面的 import 行。
type WorkflowSpecT = NonNullable<SkillRecipe['workflow']>;
type WorkflowStepT = WorkflowSpecT['steps'][number];
type WorkflowBindingT = NonNullable<WorkflowStepT['bindings']>[number];
type WorkflowInputT = NonNullable<SkillRecipe['inputs']>[number];
type WorkflowInputType = WorkflowInputT['type'];

/** inputs[].type 的取值枚举，逐字来自 SkillTypes.WorkflowInput['type'] 联合类型（DSL 字段形状），不是拟合常数。 */
const WORKFLOW_INPUT_TYPES: readonly string[] = [
  'string', 'number', 'integer', 'boolean', 'object', 'array',
];

function isWorkflowInputType(value: unknown): value is WorkflowInputType {
  return typeof value === 'string' && WORKFLOW_INPUT_TYPES.includes(value);
}

/**
 * 可选 workflow：阶段二 DAG 声明。缺省（字段没写）= 该技能走现有散文 prompt 路径，
 * 不是新写的兼容桥；显式给值时做解析期静态校验，任一不过 {ok:false} 整条拒装。
 *
 * 判据（PHASE2-CONTRACT「DSL 字段形状 / runner 语义 / 触发接线」）：
 *  - workflow 必须是对象；steps 必须是非空数组；
 *  - 每个 step 必须是对象：id 非空字符串且 steps 内唯一、call 非空字符串、
 *    args 若给必须是对象、bindings 若给必须是数组、yield 若给必须是 boolean；
 *  - 每条 binding 必须是对象：from 非空字符串且指向「位置更靠前」的真实 step id
 *    （用已遍历过的 id 集合判定 → 天然无环 / 不许自引用 / 不许指向后继节点，不需运行时 guard）、
 *    as 非空字符串、path 是字符串（'$' 表示整个上游 value）；
 *  - 不校验 call 是否命中算子白名单：白名单是运行时已启用算子表，由装配期/运行时
 *    OperatorRegistry 与 assets 侧静态校验各自把关；本文件保持纯函数、零 import。
 *  - 未知键按本模块既有口径一律忽略（只读取已知字段、只构造已知字段），不新增拒绝规则。
 */
function readWorkflowSpec(raw: Record<string, unknown>): FieldResult<WorkflowSpecT | undefined> {
  const wfRaw = raw['workflow'];
  if (wfRaw === undefined) return { ok: true, value: undefined };
  if (!isRecord(wfRaw)) return { ok: false, reason: '字段「workflow」必须是对象' };

  const stepsRaw = wfRaw['steps'];
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return { ok: false, reason: '字段「workflow.steps」必须是非空数组' };
  }
  const stepItems: readonly unknown[] = stepsRaw;
  const steps: WorkflowStepT[] = [];
  // 已完整解析过、位置更靠前的 step id；bindings.from 只能命中这里 → 解析期即判无环。
  const seenIds = new Set<string>();

  for (let i = 0; i < stepItems.length; i += 1) {
    const item: unknown = stepItems[i];
    const where = `workflow.steps 第 ${i + 1} 项`;
    if (!isRecord(item)) return { ok: false, reason: `${where} 必须是对象` };

    const idRes = readString(item, 'id', `${where} id`);
    if (!idRes.ok) return idRes;
    if (seenIds.has(idRes.value)) {
      return { ok: false, reason: `${where} id 重复：${idRes.value}` };
    }
    const callRes = readString(item, 'call', `${where} call`);
    if (!callRes.ok) return callRes;

    // 可选 args：字面量参数对象（键任意、整体原样保留），若给必须是对象。
    let args: Record<string, unknown> | undefined;
    const argsRaw = item['args'];
    if (argsRaw !== undefined) {
      if (!isRecord(argsRaw)) return { ok: false, reason: `${where} args 若给必须是对象` };
      args = argsRaw;
    }

    // 可选 bindings：依赖边数组；from 只能指向更靠前的真实 step id。
    let bindings: WorkflowBindingT[] | undefined;
    const bindingsRaw = item['bindings'];
    if (bindingsRaw !== undefined) {
      if (!Array.isArray(bindingsRaw)) {
        return { ok: false, reason: `${where} bindings 若给必须是数组` };
      }
      const bindingItems: readonly unknown[] = bindingsRaw;
      const out: WorkflowBindingT[] = [];
      for (let j = 0; j < bindingItems.length; j += 1) {
        const bRaw: unknown = bindingItems[j];
        const bWhere = `${where} bindings 第 ${j + 1} 条`;
        if (!isRecord(bRaw)) return { ok: false, reason: `${bWhere} 必须是对象` };
        const fromRes = readString(bRaw, 'from', `${bWhere} from`);
        if (!fromRes.ok) return fromRes;
        if (!seenIds.has(fromRes.value)) {
          return {
            ok: false,
            reason: `${bWhere} from 必须指向本 steps 数组中位置更靠前的真实 step id：${fromRes.value}`,
          };
        }
        const asRes = readString(bRaw, 'as', `${bWhere} as`);
        if (!asRes.ok) return asRes;
        const path = bRaw['path'];
        if (typeof path !== 'string') {
          return { ok: false, reason: `${bWhere} path 必须是字符串（'$' 表示整个上游 value）` };
        }
        out.push({ from: fromRes.value, path, as: asRes.value });
      }
      bindings = out;
    }

    // 可选 yield：仅显式 true 的节点 value 进模型；缺省 false（不写字段即缺省）。
    let shouldYield: boolean | undefined;
    const yieldRaw = item['yield'];
    if (yieldRaw !== undefined) {
      if (typeof yieldRaw !== 'boolean') {
        return { ok: false, reason: `${where} yield 若给必须是 boolean` };
      }
      shouldYield = yieldRaw;
    }

    // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined；只构造已知字段。
    const step: WorkflowStepT = {
      id: idRes.value,
      call: callRes.value,
      ...(args !== undefined ? { args } : {}),
      ...(bindings !== undefined ? { bindings } : {}),
      ...(shouldYield !== undefined ? { yield: shouldYield } : {}),
    };
    steps.push(step);
    // 当前 id 处理完才入集合 → 本步骤 bindings 不能引用自己，也不能引用后继节点。
    seenIds.add(idRes.value);
  }

  return { ok: true, value: { steps } };
}

/**
 * 可选 inputs[]：模型在 yield 边界填空的参数契约。
 *
 * 判据（PHASE2-CONTRACT「3 条配方精确声明 / DSL 字段形状」）：
 *  - 若给必须是数组；每项必须是对象；
 *  - name 非空字符串且同一 inputs 内唯一；type 必须落在 WorkflowInput.type 枚举内；
 *  - default 与 type 不做深度校验（宿主 runner 合并时处理）；
 *    required:true 同时给 default 不算错（不做任何组合判定）；
 *  - 可选字段形状按本文件 parseSecretSpec 口径逐项校验后原样保留：
 *    required 若给必须是 boolean、enum 若给必须是数组（元素内容由宿主校验）；
 *  - 未知键一律忽略（只构造已知字段）。
 */
function readWorkflowInputs(raw: Record<string, unknown>): FieldResult<WorkflowInputT[] | undefined> {
  const inputsRaw = raw['inputs'];
  if (inputsRaw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(inputsRaw)) return { ok: false, reason: '字段「inputs」必须是数组' };
  const items: readonly unknown[] = inputsRaw;
  const out: WorkflowInputT[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < items.length; i += 1) {
    const item: unknown = items[i];
    const where = `inputs 第 ${i + 1} 项`;
    if (!isRecord(item)) return { ok: false, reason: `${where} 必须是对象` };

    const nameRes = readString(item, 'name', `${where} name`);
    if (!nameRes.ok) return nameRes;
    if (seenNames.has(nameRes.value)) {
      return { ok: false, reason: `${where} name 重复：${nameRes.value}` };
    }
    const type = item['type'];
    if (!isWorkflowInputType(type)) {
      return { ok: false, reason: `${where} type 必须是 string/number/integer/boolean/object/array 之一` };
    }

    let required: boolean | undefined;
    const requiredRaw = item['required'];
    if (requiredRaw !== undefined) {
      if (typeof requiredRaw !== 'boolean') {
        return { ok: false, reason: `${where} required 若给必须是 boolean` };
      }
      required = requiredRaw;
    }
    let enumVal: unknown[] | undefined;
    const enumRaw = item['enum'];
    if (enumRaw !== undefined) {
      if (!Array.isArray(enumRaw)) {
        return { ok: false, reason: `${where} enum 若给必须是数组` };
      }
      enumVal = enumRaw;
    }
    const hasDefault = item['default'] !== undefined;

    // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined；只构造已知字段。
    const input: WorkflowInputT = {
      name: nameRes.value,
      type,
      ...(required !== undefined ? { required } : {}),
      ...(hasDefault ? { default: item['default'] } : {}),
      ...(enumVal !== undefined ? { enum: enumVal } : {}),
    };
    out.push(input);
    seenNames.add(nameRes.value);
  }

  return { ok: true, value: out };
}

/**
 * 命名入口：解析 `workflow` / `inputs` 两项声明（阶段二「readWorkflow(raw)」）。
 * 任一不过返回 {ok:false}，由 parseSkillRecipe 整条拒装，沿用现有错误口径。
 * 只读 / 纯函数，不查宿主注册表、不引入对 OperatorRegistry 的依赖。
 */
function readWorkflow(raw: Record<string, unknown>): FieldResult<{
  workflow: WorkflowSpecT | undefined;
  inputs: WorkflowInputT[] | undefined;
}> {
  const workflow = readWorkflowSpec(raw);
  if (!workflow.ok) return workflow;
  const inputs = readWorkflowInputs(raw);
  if (!inputs.ok) return inputs;
  return { ok: true, value: { workflow: workflow.value, inputs: inputs.value } };
}

export function parseSkillRecipe(
  raw: unknown,
): { ok: true; skill: SkillRecipe } | { ok: false; reason: string } {
  if (!isRecord(raw)) {
    return { ok: false, reason: '技能配方必须是一个对象' };
  }
  if (raw['schemaVersion'] !== 1) {
    return { ok: false, reason: '技能配方字段「schemaVersion」必须等于 1' };
  }

  const id = readString(raw, 'id', 'id');
  if (!id.ok) return id;
  const version = readVersion(raw);
  if (!version.ok) return version;
  const name = readString(raw, 'name', 'name');
  if (!name.ok) return name;
  const summary = readString(raw, 'summary', 'summary');
  if (!summary.ok) return summary;
  const primitives = readPrimitives(raw);
  if (!primitives.ok) return primitives;
  const category = readCategory(raw);
  if (!category.ok) return category;
  const secrets = readSecrets(raw);
  if (!secrets.ok) return secrets;
  const prompt = readString(raw, 'prompt', 'prompt');
  if (!prompt.ok) return prompt;
  const wf = readWorkflow(raw);
  if (!wf.ok) return wf;

  // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined。
  const skill: SkillRecipe = {
    schemaVersion: 1,
    id: id.value,
    version: version.value,
    name: name.value,
    summary: summary.value,
    primitives: primitives.value,
    ...(secrets.value !== undefined ? { secrets: secrets.value } : {}),
    ...(category.value !== undefined ? { category: category.value } : {}),
    ...(wf.value.workflow !== undefined ? { workflow: wf.value.workflow } : {}),
    ...(wf.value.inputs !== undefined ? { inputs: wf.value.inputs } : {}),
    prompt: prompt.value,
  };
  return { ok: true, skill };
}

export function parseSkillRegistry(
  raw: unknown,
): { ok: true; registry: SkillRegistryFile } | { ok: false; reason: string } {
  if (!isRecord(raw)) {
    return { ok: false, reason: '技能清单必须是一个对象' };
  }
  if (raw['schemaVersion'] !== 1) {
    return { ok: false, reason: '技能清单字段「schemaVersion」必须等于 1' };
  }

  const name = readString(raw, 'name', 'name');
  if (!name.ok) return name;
  const description = readString(raw, 'description', 'description');
  if (!description.ok) return description;

  const value = raw['skills'];
  if (!Array.isArray(value)) {
    return { ok: false, reason: '技能清单字段「skills」必须是数组' };
  }
  const items: readonly unknown[] = value;
  const skills: SkillRecipe[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const parsed = parseSkillRecipe(items[i]);
    if (!parsed.ok) {
      return { ok: false, reason: `技能清单「skills」第 ${i + 1} 项无效：${parsed.reason}` };
    }
    skills.push(parsed.skill);
  }

  const registry: SkillRegistryFile = {
    schemaVersion: 1,
    name: name.value,
    description: description.value,
    skills,
  };
  return { ok: true, registry };
}
