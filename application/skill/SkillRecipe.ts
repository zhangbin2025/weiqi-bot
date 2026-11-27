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

import type { SkillIndexEntry, SkillRecipe, SkillRegistryIndex } from './SkillTypes';
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

/**
 * 可选 routeHint（可选路由词）：短语数组，由配方自行声明「用户说什么话时选这条」，
 * 只供路由目录消费；与 summary（命中后的执行说明）正交。
 *
 * 两种口径各有出处，别混：
 * - 宽松缺省（沿用 category / 老 routeHint 的既有口径）：字段本身是可选的，
 *   没写 / 写歪成非数组（含误写单字符串、null、数字）/ 空数组 / 数组里全是
 *   空白项，一律当缺省（返回 undefined，不往配方上挂这个键）。可选字段不该
 *   因为「写得不对」就拒掉整条合法配方；缺省 = 目录只给 id|name。
 * - 严格内容（来自目录渲染约束）：一旦写成数组且过滤后仍有有效项，每一项都
 *   必须是 string、trim 后非空、不含 \r\n。目录一技能一行，路由词必须是单行
 *   非空短语，任一不满足就拒绝整条配方。
 *
 * 不设词数上限 / 长度阈值 / 截断启发式（项目铁律：不引入无出处的新常数）。
 * 合法时返回 trim 后的 string[]（过滤掉 trim 后为空的项），保持配方给定顺序。
 */
function readRouteWords(raw: Record<string, unknown>): FieldResult<string[] | undefined> {
  const value = raw['routeHint'];
  if (value === undefined || !Array.isArray(value)) return { ok: true, value: undefined };
  const items: readonly unknown[] = value;
  const out: string[] = [];
  for (const item of items) {
    // 非数组已按宽松口径当缺省；数组内的项则按严格口径校验内容：
    // 必须是 string 且不含 \r\n（换行不该被空白过滤悄悄吞掉），trim 后非空。
    if (typeof item !== 'string' || /[\r\n]/.test(item)) {
      return {
        ok: false,
        reason: '字段「routeHint」数组内每项必须是单行非空字符串短语（目录一技能一行，路由词不能含换行）',
      };
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) continue; // 纯空白项：过滤掉，不算有效路由词
    out.push(trimmed);
  }
  return out.length > 0
    ? { ok: true, value: out }
    : { ok: true, value: undefined }; // 空数组 / 全空白 → 缺省
}

/**
 * 可选 returnToLLM：若给必须是 boolean（其它值报错）；缺省 = undefined（默认 false）。
 * 与 readWorkflowSpec 里 yield / required 的「若给必须是 boolean」口径一致，
 * 字段本身可选、不直塞 undefined（exactOptionalPropertyTypes）。
 */
function readReturnToLLM(raw: Record<string, unknown>): FieldResult<boolean | undefined> {
  const value = raw['returnToLLM'];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'boolean') {
    return { ok: false, reason: '字段「returnToLLM」若给必须是 boolean' };
  }
  return { ok: true, value };
}

/**
 * 可选 llmProjection（B3）：returnToLLM:true 时声明哪些 yield 顶层段进 LLM 视图。
 * 对象 / 非数组 / keep 为非空字符串数组、每项 trim 后非空，逐字保留原顺序与值
 * （不去重、不 trim 改写声明本身）；非法按既有字段风格抛中文错误。
 * 缺省 / 字段缺失 = undefined（B2 全量，零回归）。「非空数组」是声明式白名单的
 * 结构有效性（空列表＝等于没声明），不是数值阈值 / 不引入常量。
 */
function readLlmProjection(
  raw: Record<string, unknown>,
): FieldResult<NonNullable<SkillRecipe['llmProjection']> | undefined> {
  const value = raw['llmProjection'];
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) {
    return { ok: false, reason: '技能配方字段「llmProjection」必须是 { keep: 非空字符串数组 }' };
  }
  const keep = value['keep'];
  if (!Array.isArray(keep) || keep.length === 0) {
    return { ok: false, reason: '技能配方字段「llmProjection」必须是 { keep: 非空字符串数组 }' };
  }
  const items: readonly unknown[] = keep;
  for (const item of items) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return { ok: false, reason: '技能配方字段「llmProjection」必须是 { keep: 非空字符串数组 }' };
    }
  }
  return { ok: true, value: { keep: keep as string[] } };
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
 * 可选 workflow：声明式算子链与受限循环。缺省（字段没写）= 该技能走现有散文 prompt 路径，
 * 不是新写的兼容桥；显式给值时做解析期静态校验，任一不过 {ok:false} 整条拒装。
 *
 * 判据（PHASE2-CONTRACT「DSL 字段形状 / runner 语义 / 触发接线」）：
 *  - workflow 必须是对象；steps 必须是非空数组；
 *  - 每个 step 必须是普通算子调用、forEach 或 repeat 三种形态之一；节点 id 在当前作用域唯一；
 *  - forEach 来源必须是更早节点，循环体非空；repeat 必须有正整数/输入占位符次数、状态输出与 boolean 停止条件；
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

  type ParsedSteps = { steps: WorkflowStepT[]; ids: Set<string> };
  const parseSteps = (
    source: readonly unknown[],
    inheritedIds: ReadonlySet<string>,
    where: string,
  ): FieldResult<ParsedSteps> => {
    const available = new Set(inheritedIds);
    const localIds = new Set<string>();
    const out: WorkflowStepT[] = [];
    for (let i = 0; i < source.length; i += 1) {
      const item = source[i];
      const at = `${where} 第 ${i + 1} 项`;
      if (!isRecord(item)) return { ok: false, reason: `${at} 必须是对象` };
      const idRes = readString(item, 'id', `${at} id`);
      if (!idRes.ok) return idRes;
      if (localIds.has(idRes.value)) return { ok: false, reason: `${at} id 重复：${idRes.value}` };

      const callRaw = item['call'];
      const forEachRaw = item['forEach'];
      const repeatRaw = item['repeat'];
      const ifElseRaw = item['ifElse'];
      if (callRaw !== undefined && (typeof callRaw !== 'string' || !callRaw.trim())) {
        return { ok: false, reason: `${at} call 若给必须是非空字符串` };
      }
      if ((forEachRaw !== undefined || repeatRaw !== undefined || ifElseRaw !== undefined)
        && (item['args'] !== undefined || item['bindings'] !== undefined)) {
        return { ok: false, reason: `${at} 控制结构节点不能声明 args 或 bindings` };
      }
      const modes = Number(typeof callRaw === 'string' && callRaw.trim().length > 0)
        + Number(forEachRaw !== undefined) + Number(repeatRaw !== undefined)
        + Number(ifElseRaw !== undefined);
      if (modes !== 1) {
        return { ok: false, reason: `${at} 必须且只能声明 call、forEach、repeat、ifElse 其中一种` };
      }

      let args: Record<string, unknown> | undefined;
      if (item['args'] !== undefined) {
        if (!isRecord(item['args'])) return { ok: false, reason: `${at} args 若给必须是对象` };
        args = item['args'];
      }
      let bindings: WorkflowBindingT[] | undefined;
      if (item['bindings'] !== undefined) {
        if (!Array.isArray(item['bindings'])) return { ok: false, reason: `${at} bindings 若给必须是数组` };
        const parsedBindings: WorkflowBindingT[] = [];
        for (let j = 0; j < item['bindings'].length; j += 1) {
          const b = item['bindings'][j];
          const bc = `${at} bindings 第 ${j + 1} 条`;
          if (!isRecord(b)) return { ok: false, reason: `${bc} 必须是对象` };
          const from = readString(b, 'from', `${bc} from`);
          if (!from.ok) return from;
          if (!available.has(from.value)) return { ok: false, reason: `${bc} from 必须指向位置更靠前的节点：${from.value}` };
          const as = readString(b, 'as', `${bc} as`);
          if (!as.ok) return as;
          if (typeof b['path'] !== 'string') return { ok: false, reason: `${bc} path 必须是字符串` };
          parsedBindings.push({ from: from.value, path: b['path'], as: as.value });
        }
        bindings = parsedBindings;
      }

      let shouldYield: boolean | undefined;
      if (item['yield'] !== undefined) {
        if (typeof item['yield'] !== 'boolean') return { ok: false, reason: `${at} yield 若给必须是 boolean` };
        shouldYield = item['yield'];
      }

      let step: WorkflowStepT;
      if (typeof callRaw === 'string' && callRaw.trim()) {
        if (forEachRaw !== undefined || repeatRaw !== undefined) return { ok: false, reason: `${at} 普通算子节点不能同时声明循环` };
        step = {
          id: idRes.value,
          call: callRaw,
          ...(args !== undefined ? { args } : {}),
          ...(bindings !== undefined ? { bindings } : {}),
          ...(shouldYield !== undefined ? { yield: shouldYield } : {}),
        };
      } else if (forEachRaw !== undefined) {
        if (!isRecord(forEachRaw)) return { ok: false, reason: `${at} forEach 必须是对象` };
        const from = readString(forEachRaw, 'from', `${at} forEach.from`);
        if (!from.ok) return from;
        if (!available.has(from.value)) return { ok: false, reason: `${at} forEach.from 必须指向位置更靠前的节点：${from.value}` };
        if (typeof forEachRaw['path'] !== 'string') return { ok: false, reason: `${at} forEach.path 必须是字符串` };
        const onErrorRaw = forEachRaw['onError'];
        if (onErrorRaw !== undefined && onErrorRaw !== 'fail' && onErrorRaw !== 'continue') {
          return { ok: false, reason: `${at} forEach.onError 只允许 fail 或 continue` };
        }
        if (!Array.isArray(forEachRaw['steps']) || forEachRaw['steps'].length === 0) {
          return { ok: false, reason: `${at} forEach.steps 必须是非空数组` };
        }
        const nested = parseSteps(forEachRaw['steps'], available, `${at}.forEach.steps`);
        if (!nested.ok) return nested;
        step = {
          id: idRes.value,
          forEach: {
            from: from.value,
            path: forEachRaw['path'],
            ...(onErrorRaw !== undefined ? { onError: onErrorRaw } : {}),
            steps: nested.value.steps,
          },
          ...(shouldYield !== undefined ? { yield: shouldYield } : {}),
        };
      } else if (ifElseRaw !== undefined) {
        if (!isRecord(ifElseRaw)) return { ok: false, reason: `${at} ifElse 必须是对象` };
        const conditionRaw = ifElseRaw['condition'];
        if (!isRecord(conditionRaw)) return { ok: false, reason: `${at} ifElse.condition 必须是对象` };
        const conditionFrom = readString(conditionRaw, 'from', `${at} ifElse.condition.from`);
        if (!conditionFrom.ok) return conditionFrom;
        if (!available.has(conditionFrom.value)) {
          return { ok: false, reason: `${at} ifElse.condition.from 必须指向位置更靠前的节点：${conditionFrom.value}` };
        }
        if (typeof conditionRaw['path'] !== 'string') {
          return { ok: false, reason: `${at} ifElse.condition.path 必须是字符串` };
        }
        if (!Array.isArray(ifElseRaw['then']) || ifElseRaw['then'].length === 0) {
          return { ok: false, reason: `${at} ifElse.then 必须是非空数组` };
        }
        if (ifElseRaw['else'] !== undefined && !Array.isArray(ifElseRaw['else'])) {
          return { ok: false, reason: `${at} ifElse.else 若给必须是数组` };
        }
        const thenParsed = parseSteps(ifElseRaw['then'], available, `${at}.ifElse.then`);
        if (!thenParsed.ok) return thenParsed;
        const elseParsed = ifElseRaw['else'] === undefined
          ? { ok: true as const, value: { steps: [] as WorkflowStepT[], ids: new Set<string>() } }
          : parseSteps(ifElseRaw['else'] as readonly unknown[], available, `${at}.ifElse.else`);
        if (!elseParsed.ok) return elseParsed;
        step = {
          id: idRes.value,
          ifElse: {
            condition: { from: conditionFrom.value, path: conditionRaw['path'] },
            then: thenParsed.value.steps,
            ...(ifElseRaw['else'] !== undefined ? { else: elseParsed.value.steps } : {}),
          },
          ...(shouldYield !== undefined ? { yield: shouldYield } : {}),
        };
      } else {
        if (!isRecord(repeatRaw)) return { ok: false, reason: `${at} repeat 必须是对象` };
        const max = repeatRaw['maxIterations'];
        if (!(typeof max === 'number' && Number.isInteger(max) && max > 0 && max <= 100)
          && !(typeof max === 'string' && /^\{\{input\.[^{}]+\}\}$/.test(max))) {
          return { ok: false, reason: `${at} repeat.maxIterations 必须是正整数或完整 input 占位符` };
        }
        let initialState: Record<string, unknown> | undefined;
        if (repeatRaw['initialState'] !== undefined) {
          if (!isRecord(repeatRaw['initialState'])) return { ok: false, reason: `${at} repeat.initialState 若给必须是对象` };
          initialState = repeatRaw['initialState'];
        }
        if (!Array.isArray(repeatRaw['steps']) || repeatRaw['steps'].length === 0) {
          return { ok: false, reason: `${at} repeat.steps 必须是非空数组` };
        }
        const nested = parseSteps(repeatRaw['steps'], available, `${at}.repeat.steps`);
        if (!nested.ok) return nested;
        const readLoopRef = (value: unknown, name: string): FieldResult<{ from: string; path: string }> => {
          if (!isRecord(value)) return { ok: false, reason: `${at} repeat.${name} 必须是对象` };
          const from = readString(value, 'from', `${at} repeat.${name}.from`);
          if (!from.ok) return from;
          if (!nested.value.ids.has(from.value)) return { ok: false, reason: `${at} repeat.${name}.from 必须指向循环体内节点：${from.value}` };
          if (typeof value['path'] !== 'string') return { ok: false, reason: `${at} repeat.${name}.path 必须是字符串` };
          return { ok: true, value: { from: from.value, path: value['path'] } };
        };
        const stateFrom = readLoopRef(repeatRaw['stateFrom'], 'stateFrom');
        if (!stateFrom.ok) return stateFrom;
        const until = readLoopRef(repeatRaw['until'], 'until');
        if (!until.ok) return until;
        step = {
          id: idRes.value,
          repeat: {
            maxIterations: max as number | string,
            ...(initialState !== undefined ? { initialState } : {}),
            stateFrom: stateFrom.value,
            until: until.value,
            steps: nested.value.steps,
          },
          ...(shouldYield !== undefined ? { yield: shouldYield } : {}),
        };
      }

      out.push(step);
      localIds.add(idRes.value);
      available.add(idRes.value);
    }
    return { ok: true, value: { steps: out, ids: localIds } };
  };

  const parsed = parseSteps(stepsRaw, new Set<string>(), 'workflow.steps');
  if (!parsed.ok) return parsed;
  return { ok: true, value: { steps: parsed.value.steps } };
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

type WorkflowTemplateScope = { item: boolean; index: boolean; state: boolean };

/**
 * 安装期校验模板占位符，避免配方装成功后才在运行到深层循环时失败。
 * 作用域按 Runner 的实际规则继承：forEach 增加 item/index，repeat 增加 state，
 * ifElse 不改变作用域；嵌套控制块可以同时访问外层作用域。
 */
function validateWorkflowTemplates(
  value: unknown,
  inputNames: ReadonlySet<string>,
  scope: WorkflowTemplateScope,
  where: string,
  seen = new WeakSet<object>(),
): FieldResult<true> {
  if (typeof value === 'string') {
    const placeholderPattern = /\{\{([^{}]*)\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = placeholderPattern.exec(value)) !== null) {
      const token = match[1] ?? '';
      const urlEncode = token.startsWith('urlencode.');
      const name = urlEncode ? token.slice('urlencode.'.length) : token;
      const inputMatch = /^input\\.(.+)$/.exec(name);
      if (inputMatch) {
        if (!inputNames.has(inputMatch[1]!)) {
          return { ok: false, reason: `${where} 引用了未声明的输入参数：${inputMatch[1]}` };
        }
        continue;
      }
      if (name === 'index') {
        if (urlEncode || !scope.index) {
          return { ok: false, reason: `${where} 的占位符 {{${token}}} 只能在 forEach 循环体内使用` };
        }
        continue;
      }
      const itemMatch = /^(item)(?:\\.(.+))?$/.exec(name);
      if (itemMatch) {
        if (!scope.item) {
          return { ok: false, reason: `${where} 的占位符 {{${token}}} 只能在 forEach 循环体内使用` };
        }
        continue;
      }
      const stateMatch = /^(state)(?:\\.(.+))?$/.exec(name);
      if (stateMatch) {
        if (!scope.state) {
          return { ok: false, reason: `${where} 的占位符 {{${token}}} 只能在 repeat 循环体内使用` };
        }
        continue;
      }
      return { ok: false, reason: `${where} 包含不支持的 Workflow 占位符：{{${token}}}` };
    }
    return { ok: true, value: true };
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return { ok: false, reason: `${where} 不能包含循环引用` };
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const nested = validateWorkflowTemplates(value[i], inputNames, scope, `${where}[${i}]`, seen);
        if (!nested.ok) return nested;
      }
    } else if (isRecord(value)) {
      for (const [key, nestedValue] of Object.entries(value)) {
        const nested = validateWorkflowTemplates(nestedValue, inputNames, scope, `${where}.${key}`, seen);
        if (!nested.ok) return nested;
      }
    }
    seen.delete(value);
  }
  return { ok: true, value: true };
}

function validateWorkflowStepTemplates(
  steps: readonly WorkflowStepT[],
  inputNames: ReadonlySet<string>,
  scope: WorkflowTemplateScope,
): FieldResult<true> {
  for (const step of steps) {
    if (step.args !== undefined) {
      const args = validateWorkflowTemplates(step.args, inputNames, scope, `workflow 节点 ${step.id}.args`);
      if (!args.ok) return args;
    }
    if (step.forEach !== undefined) {
      const nested = validateWorkflowStepTemplates(step.forEach.steps, inputNames, {
        ...scope, item: true, index: true,
      });
      if (!nested.ok) return nested;
    }
    if (step.ifElse !== undefined) {
      const thenNested = validateWorkflowStepTemplates(step.ifElse.then, inputNames, scope);
      if (!thenNested.ok) return thenNested;
      const elseNested = validateWorkflowStepTemplates(step.ifElse.else ?? [], inputNames, scope);
      if (!elseNested.ok) return elseNested;
    }
    if (step.repeat !== undefined) {
      if (step.repeat.initialState !== undefined) {
        const initial = validateWorkflowTemplates(
          step.repeat.initialState, inputNames, scope, `workflow 节点 ${step.id}.repeat.initialState`,
        );
        if (!initial.ok) return initial;
      }
      const nested = validateWorkflowStepTemplates(step.repeat.steps, inputNames, {
        ...scope, state: true,
      });
      if (!nested.ok) return nested;
    }
  }
  return { ok: true, value: true };
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

  const inputNames = new Set((inputs.value ?? []).map((input) => input.name));
  const validateRepeatInputs = (steps: readonly WorkflowStepT[]): FieldResult<true> => {
    for (const step of steps) {
      if (step.forEach !== undefined) {
        const nested = validateRepeatInputs(step.forEach.steps);
        if (!nested.ok) return nested;
      }
      if (step.ifElse !== undefined) {
        const thenNested = validateRepeatInputs(step.ifElse.then);
        if (!thenNested.ok) return thenNested;
        const elseNested = validateRepeatInputs(step.ifElse.else ?? []);
        if (!elseNested.ok) return elseNested;
      }
      if (step.repeat !== undefined) {
        if (typeof step.repeat.maxIterations === 'string') {
          const match = /^\{\{input\.([^{}]+)\}\}$/.exec(step.repeat.maxIterations);
          if (match && !inputNames.has(match[1]!)) {
            return { ok: false, reason: 'repeat.maxIterations 引用了未声明的输入参数：' + match[1] };
          }
        }
        const nested = validateRepeatInputs(step.repeat.steps);
        if (!nested.ok) return nested;
      }
    }
    return { ok: true, value: true };
  };
  if (workflow.value !== undefined) {
    const repeatInputs = validateRepeatInputs(workflow.value.steps);
    if (!repeatInputs.ok) return repeatInputs;
    const templates = validateWorkflowStepTemplates(workflow.value.steps, inputNames, {
      item: false, index: false, state: false,
    });
    if (!templates.ok) return templates;
  }
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
  const routeHint = readRouteWords(raw);
  if (!routeHint.ok) return routeHint;
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
  const returnToLLM = readReturnToLLM(raw);
  if (!returnToLLM.ok) return returnToLLM;
  const llmProjection = readLlmProjection(raw);
  if (!llmProjection.ok) return llmProjection;

  // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined。
  const skill: SkillRecipe = {
    schemaVersion: 1,
    id: id.value,
    version: version.value,
    name: name.value,
    summary: summary.value,
    ...(routeHint.value !== undefined ? { routeHint: routeHint.value } : {}),
    primitives: primitives.value,
    ...(secrets.value !== undefined ? { secrets: secrets.value } : {}),
    ...(category.value !== undefined ? { category: category.value } : {}),
    ...(wf.value.workflow !== undefined ? { workflow: wf.value.workflow } : {}),
    ...(wf.value.inputs !== undefined ? { inputs: wf.value.inputs } : {}),
    ...(returnToLLM.value !== undefined ? { returnToLLM: returnToLLM.value } : {}),
    ...(llmProjection.value !== undefined ? { llmProjection: llmProjection.value } : {}),
    prompt: prompt.value,
  };
  return { ok: true, skill };
}

/**
 * 索引条目的 primitives：与 readPrimitives 的差别只在「允许空数组」。
 * 索引里看不到 workflow 声明，无法套用「无 workflow 时必须 >=1」判据；
 * 两条 workflow 配方的 primitives 本来就是 []，不能在这里误拒。
 * 名字格式仍沿用同一正则，未知字段一律忽略。
 */
function readIndexPrimitives(raw: Record<string, unknown>): FieldResult<string[]> {
  const value = raw['primitives'];
  if (!Array.isArray(value)) {
    return { ok: false, reason: '字段「primitives」必须是字符串数组' };
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

/** 逐条索引校验：只取已知字段，不做 URL 解析（路径安全性交给 client） */
function parseSkillIndexEntry(raw: unknown): FieldResult<SkillIndexEntry> {
  if (!isRecord(raw)) {
    return { ok: false, reason: '索引条目必须是一个对象' };
  }
  const id = readString(raw, 'id', 'id');
  if (!id.ok) return id;
  const version = readVersion(raw);
  if (!version.ok) return version;
  const name = readString(raw, 'name', 'name');
  if (!name.ok) return name;
  const summary = readString(raw, 'summary', 'summary');
  if (!summary.ok) return summary;
  const routeHint = readRouteWords(raw);
  if (!routeHint.ok) return routeHint;
  const primitives = readIndexPrimitives(raw);
  if (!primitives.ok) return primitives;
  const category = readCategory(raw);
  if (!category.ok) return category;
  const path = readString(raw, 'path', 'path');
  if (!path.ok) return path;

  // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined；只构造已知字段。
  const entry: SkillIndexEntry = {
    id: id.value,
    version: version.value,
    name: name.value,
    summary: summary.value,
    ...(routeHint.value !== undefined ? { routeHint: routeHint.value } : {}),
    primitives: primitives.value,
    ...(category.value !== undefined ? { category: category.value } : {}),
    path: path.value,
  };
  return { ok: true, value: entry };
}

/**
 * 瘦索引（schemaVersion:2）解析：顶层只验清单骨架，逐条验索引条目。
 * 与 parseSkillRecipe 的 schemaVersion:1 语义不同：那份是单条完整配方
 * （本地库 / 安装 / skills/<id>/skill.json）的契约，两者互不替代。
 */
export function parseSkillRegistryIndex(
  raw: unknown,
): { ok: true; registry: SkillRegistryIndex } | { ok: false; reason: string } {
  if (!isRecord(raw)) {
    return { ok: false, reason: '技能清单必须是一个对象' };
  }
  if (raw['schemaVersion'] !== 2) {
    return {
      ok: false,
      reason: `不认识的技能清单 schemaVersion：${String(raw['schemaVersion'])}（宿主只支持 2）`,
    };
  }

  const name = readString(raw, 'name', 'name');
  if (!name.ok) return name;
  const description = readString(raw, 'description', 'description');
  if (!description.ok) return description;

  const value = raw['skills'];
  if (!Array.isArray(value)) {
    return { ok: false, reason: '技能清单字段「skills」必须是数组' };
  }

  // 可选 baseUrl：缺省 / 空串都当「没给」，交给 client 的 resolveBaseUrl 兜底；
  // 显式给值时必须是字符串（非字符串直接拒，不静默吞掉）。
  let baseUrl: string | undefined;
  const baseRaw = raw['baseUrl'];
  if (baseRaw !== undefined) {
    if (typeof baseRaw !== 'string') {
      return { ok: false, reason: '字段「baseUrl」若给必须是字符串' };
    }
    if (baseRaw.trim()) baseUrl = baseRaw;
  }

  const items: readonly unknown[] = value;
  const skills: SkillIndexEntry[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const parsed = parseSkillIndexEntry(items[i]);
    if (!parsed.ok) {
      return { ok: false, reason: `技能清单「skills」第 ${i + 1} 项无效：${parsed.reason}` };
    }
    skills.push(parsed.value);
  }

  // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined。
  const registry: SkillRegistryIndex = {
    schemaVersion: 2,
    name: name.value,
    description: description.value,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    skills,
  };
  return { ok: true, registry };
}
