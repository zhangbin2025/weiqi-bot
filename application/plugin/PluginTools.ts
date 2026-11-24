/**
 * 插件开发工具集（标准 tool-calling）
 * @module application/plugin/PluginTools
 *
 * 设计不变式：**创建与修订同构**。
 * `plugin_write` 一个工具覆盖「建」和「改」（靠 artifactId 有无区分）：
 * 模型一次 tool_call 给出完整源码 → 宿主做确定性试算 → 落一个版本 →
 * 把试算结果作为观察回填。第二版、第三版就是同一个 agent loop 里
 * 第 2、第 3 次 plugin_write，走一模一样的路径，没有重载的特殊循环，
 * 没有独立 verifier 模型判定，没有 diff 闸门，没有自造 JSON 动作协议。
 *
 * 终止条件 = 模型不再调工具（标准 loop 自然收敛）。试算失败不落库，
 * 失败原因变观察回喂，模型自己决定重试；这类「提交源码 → 验收失败 → 重写」
 * 由 repairable 标记交给共用 loop 计为同一次决策的延续，不占决策预算。
 * 同理，list/show/history/debug 这些只读准备工具也标 preparatory，让「一个意图串起
 * 的多步查询」不各自吃掉一次决策（否则第一次开发就会撞满 4 次上限）。两类延续共用
 * /llm repairs 的 maxAttempts 作为连续上限，见 ToolLoop.ts 头部口径。
 * 状态变更工具(write/toggle/delete/apply/rollback) 不标，仍是逐次自主决策。
 *
 * 一切操作都是工具：调试(试算)、历史、回滚、启停、删除、应用为页面当前口径。
 * 执行器与 UI 面板共用同一批 service，消除「模型一套、按钮一套」的分裂。
 *
 * 扩展点语义（代表性输入 / 输出校验 / 观察文案 / 默认口径）全部由装配根注入的
 * 行为注册表按 pointId 提供；本文件不 import 任何业务模块、不默认某个扩展点。
 * 沙箱 limits 仍沿用宿主 PluginSpec，本文件不引入任何新阈值/经验常数。
 */

import type { ModelToolDefinition } from '../model/IModelGateway';
import type { ToolOutcome, ToolExecutor } from '../chat/ToolLoop';
import {
  resolvePluginSpec, PLUGIN_SPECS,
  type IPluginRuntime, type PluginArtifact, type PluginRevision,
  type PluginContextEntry, type PluginRunResult, type PluginSpec,
  type OperatorArtifactContract,
} from '@domain/plugin/types';
import type {
  ExtensionPointBehavior, ExtensionPointBehaviorRegistry,
} from '@domain/plugin/ExtensionPointBehavior';
import { resolveExtensionPointBehavior } from '@domain/plugin/ExtensionPointBehavior';
import { createExtensionPointBehaviors } from './behaviors';
import { validatePluginOutput } from '@domain/plugin/PluginValidator';
import { PluginArtifactService } from './PluginArtifactService';
import { PluginContextProvider } from './PluginContextProvider';
import { PluginValidator } from '@domain/plugin/PluginValidator';
import { resolvePluginName } from './PluginNaming';
import { DEFAULT_PLUGIN_MAX_ATTEMPTS } from './PluginConfig';

// ---------- 工具名 ----------

export const PLUGIN_TOOL_NAMES = {
  list: 'plugin_list',
  show: 'plugin_show',
  history: 'plugin_history',
  write: 'plugin_write',
  debug: 'plugin_debug',
  toggle: 'plugin_toggle',
  delete: 'plugin_delete',
  apply: 'plugin_apply',
  rollback: 'plugin_rollback',
} as const;

// ---------- 依赖端口 ----------

export interface PluginToolDeps {
  artifacts: PluginArtifactService;
  runtime: IPluginRuntime;
  validator: PluginValidator;
  snapshot: PluginContextProvider;
  /**
   * 页面「当前选中的插件」持久化。undefined = 切回内置。
   * 由装配根提供，工具集不依赖具体存储实现。
   */
  applySelection: (artifactId: string | undefined) => Promise<void>;
  /** 扩展点行为注册表；由装配根注入，缺省时用默认注册表（测试便利） */
  behaviors?: ExtensionPointBehaviorRegistry;
  /** 可选：/llm repairs 配置的自动修复轮数；工具集换算成 loop 的总决策轮数上限 */
  maxAttempts?: number;
  /** 工件集合 / enabled 状态发生成功变更后刷新算子表快照（模型侧启停/新建/删除/修订） */
  onArtifactChange?: () => void | Promise<void>;
}

export interface PluginToolKit {
  tools: ModelToolDefinition[];
  executors: Record<string, ToolExecutor>;
  /** 每轮 turn 动态生成：实时读工件清单，不依赖会话历史 */
  systemPrompt: () => Promise<string>;
  /** 自主决策轮数上限 = maxAttempts + 1；修复延续不占此预算（见 ToolLoop.ts） */
  maxTurns: number;
}

// ---------- 契约文本（由扩展点行为注册表按 pointId 提供，框架不写死业务口径） ----------

/** 从行为注册表收集全部扩展点的沙箱契约说明，按 pointId 顺序拼接 */
function contractLinesOf(behaviors: ExtensionPointBehaviorRegistry): string {
  return Object.values(behaviors)
    .map((b) => `【${b.label}｜${b.pointId}】
${b.contractLines}`)
    .join('\n\n');
}

/** 从行为注册表收集 pointId 说明，供工具参数 description 使用 */
function pointIdDescriptionOf(behaviors: ExtensionPointBehaviorRegistry): string {
  return Object.values(behaviors).map((b) => b.pointIdDescription).join('；');
}

/** 从行为注册表收集 tool-calling 额外参数（如 workflow-operator 的 exposes/smoke） */
function extraParamsOf(behaviors: ExtensionPointBehaviorRegistry): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const b of Object.values(behaviors)) {
    if (b.extraParams !== undefined) Object.assign(out, b.extraParams);
  }
  return out;
}

/** 从行为注册表收集自定义试算输入参数（如 ranking 的 matches） */
function trialInputParamsOf(behaviors: ExtensionPointBehaviorRegistry): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const b of Object.values(behaviors)) {
    if (b.trialInput !== undefined) out[b.trialInput.param] = b.trialInput.schema;
  }
  return out;
}

const TOOL_GUIDE = [
  '- plugin_list：查看当前全部插件（id / 名字 / 版本 / 启用状态 / 原始需求）。不确定改哪个时先调它。',
  '- plugin_show：读某个插件的完整源码，可带 version 看历史版本。',
  '- plugin_history：看某个插件的版本链摘要（版本号 / 触发 / 时间 / 反馈）。',
  '- plugin_write：写入一份完整源码。不带 artifactId = 新建；带 artifactId = 修订该插件、',
  '  自动产生新版本并追加快照。参数 code 是完整 JS 源码字符串，不是 diff、不是片段。',
  '  宿主会按扩展点行为做确定性试算并把结果回填给你；试算失败则不落库。',
  '  写工作流算子时另带 pointId:"workflow-operator" + exposes[] + smoke[]，宿主改跑自检样例。',
  '- plugin_debug：对任意源码单独试算。可指定 artifactId(+version) 读已存插件、或直接给 code 试未落库的临时源码；',
  '  matches 可自定义对阵表，不传则用内置样例。返回试算结果或明确错误诊断。',
  '  调试 workflow-operator 时把 artifactId 指向算子工件，或给 code 并带 exposes[]/smoke[]；matches 不适用。',
  '- plugin_toggle：启用/停用插件，enabled 省略则按当前状态翻转。',
  '- plugin_delete：删除插件。',
  '- plugin_apply：把某个已启用且支持页面口径的插件设为当前口径；省略 artifactId = 切回内置。',
  '- plugin_rollback：让插件回到某个历史版本（产生一个新版本，旧快照都保留）。',
].join('\n');

/** 动态 system：清单实时来自工件存储，与会话历史无关 */
async function buildSystemPrompt(
  snapshot: PluginContextProvider,
  behaviors: ExtensionPointBehaviorRegistry,
): Promise<string> {
  let list = '（当前没有任何插件）';
  try {
    const entries: PluginContextEntry[] = await snapshot.snapshot();
    if (entries.length > 0) {
      list = entries.map((p) =>
        `- ${p.id} | ${p.name} | 扩展点 ${p.pointId} | ${p.enabled ? '已启用' : '停用'} | v${p.version}`
        + (p.slug !== undefined ? ` | slug=${p.slug}` : '')
        + ` | 需求：${p.intent}`,
      ).join('\n');
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    list = `（清单读取失败：${reason}；可再试 plugin_list）`;
  }

  return [
    '你是客户端里的可编程智能体，通过工具真实地查看、编写、修改、试算、启停插件。',
    '插件是某个扩展点上的纯 JavaScript 计算函数，在沙箱里执行，无网络、无存储、无 DOM、无定时器，禁止 require/import/eval。',
    '',
    '【当前插件清单】',
    list,
    '',
    '【沙箱契约】按扩展点分节，各扩展点只适用自己的那一段：',
    contractLinesOf(behaviors),
    '',
    '【可用工具】',
    TOOL_GUIDE,
    '',
    '【迭代开发】改插件就是再调一次 plugin_write 并带上 artifactId，和新建走完全相同的路径：',
    '每次写入都会自动试算，观察里会按扩展点行为返回这一版的试算结果。看结果不满意、或用户提出新要求，',
    '就调 plugin_show 读当前源码 → 按新要求改 → 再 plugin_write，如此反复直到收敛。',
    '不要用会话记忆猜源码或 id：用 plugin_list / plugin_show 的真实观察。',
    '需要验算特定对阵时用 plugin_debug 自定义 matches；调试工作流算子临时源码时给 pointId:"workflow-operator" 加 exposes/smoke；'
    + '要对比/回退用 plugin_history / plugin_rollback。',
    '',
    '【状态变更铁律】查看/启停/删除/新建/修订都必须真的调用对应工具，不能只在回复里声称完成。',
    '只有收到工具观察回执后，才能在最终回复里确认状态。用户说「启用」就调 plugin_toggle + enabled:true，',
    '说「停用」就 enabled:false；不知道指哪个插件时先 plugin_list，不要凭记忆编 id。',
    '新建/修订产生的候选默认停用，用户确认后才启用。',
    '【命名】只有用户明确给规则起了名字时才传 name；否则省略，系统自动排号，不要自己编花哨名字。',
    '写 workflow-operator 算子时给一个稳定 slug（小写字母/数字/下划线、不带点）：'
    + '启用后算子名是 <slug>.<exposes[].name>，技能配方的 workflow.steps[].call 就引用它；'
    + '新建漏给可以在修订时用 plugin_write 补 slug。',
    '',
    '【最终回复】用自然中文说明做了什么、试算结果如何、下一步建议；不要输出 JSON、不要贴整段源码。',
  ].join('\n');
}

// ---------- 参数解析（失败一律变观察，不抛给 loop） ----------

type ArgsResult<T> = { ok: true; value: T } | { ok: false; failure: ToolOutcome };

function readArgs<T>(argsJson: string, toolName: string): ArgsResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return { ok: false, failure: fail(`${toolName} 参数不是合法 JSON，请重新给出结构化参数`) };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, failure: fail(`${toolName} 参数必须是对象`) };
  }
  return { ok: true, value: parsed as T };
}

function str(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function bool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}

/** 从工件读 workflow-operator 契约；缺失时明确报错（自建算子必须带契约才能注册进算子表） */
function contractOfArtifact(artifact: PluginArtifact): OperatorArtifactContract | undefined {
  return artifact.operatorContract;
}

function fail(reason: string, detail?: string): ToolOutcome {
  return { observation: reason, ok: false, detail: detail ?? reason };
}

function ok(observation: string, detail: string, code?: string): ToolOutcome {
  const out: ToolOutcome = { observation, ok: true, detail };
  if (code) out.code = code;
  return out;
}

/** 标准 function-calling 的 arguments 是字符串；模型偶尔会带 ```js 围栏，剥掉即可 */
function normalizeCode(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:js|javascript)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

// ---------- 试算（确定性验收，唯一标准） ----------

/**
 * 一次确定性试算：快筛 → 按 pointId 查行为注册表 → 沙箱逐例执行 → 输出契约校验。
 * 所有扩展点共用同一个沙箱、同一套配额、同一条失败回喂链路；
 * 代表性输入、契约校验、观察文案、期望值比对全部由行为配方声明，框架不解读语义。
 */
interface TrialSuccess {
  ok: true;
  /** 回填给模型的观察文本（由扩展点行为格式化） */
  text: string;
  /** 本次写入/调试实际用的 spec，落库时透传给工件 */
  spec: PluginSpec;
  /** 试算通过后随工件持久化的资源契约（由行为提供，undefined = 不持久化） */
  artifactContract?: unknown;
}

/**
 * 一次确定性试算：快筛 → 按 pointId 查行为注册表 → 沙箱逐例执行 → 输出契约校验。
 * 框架不认识 ranking / workflow-operator：用例构造、契约校验、结果文案、expect 比对全部委托行为。
 * 所有扩展点共用同一个沙箱、同一套配额、同一条失败回喂链路。
 */
async function trial(
  deps: PluginToolDeps,
  behavior: ExtensionPointBehavior,
  code: string,
  spec: PluginSpec,
  options: {
    customInput?: unknown;
    contract?: unknown;
  } = {},
): Promise<TrialSuccess | { ok: false; outcome: ToolOutcome }> {
  const pre = deps.validator.validate(code, spec);
  if (!pre.ok) {
    return { ok: false, outcome: fail(`代码预检未通过：${pre.reason ?? '不合法'}。请修正后重新给出完整源码。` ) };
  }

  // 算子契约（例如 workflow-operator 的 exposes[]/smoke[]）由调用方从工具参数解析好传入；
  // 形状与合法性的进一步校验由行为声明，框架只负责传递与回喂。
  const contract = options.contract;
  if (behavior.validateContract !== undefined) {
    const bad = behavior.validateContract(contract);
    if (bad !== undefined) {
      return { ok: false, outcome: fail(`${behavior.label}契约不合法：${bad}。请补齐资源声明。` ) };
    }
  }

  const built = behavior.buildTrialCases({
    ...(options.customInput !== undefined ? { customInput: options.customInput } : {}),
    ...(contract !== undefined ? { contract } : {}),
  });
  if (!built.ok) {
    return { ok: false, outcome: fail(`${behavior.label}试算输入不合法：${built.reason}`) };
  }

  const outputs: unknown[] = [];
  for (const c of built.cases) {
    let run: PluginRunResult;
    try {
      run = await deps.runtime.run(code, c.input, spec);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, outcome: fail(`沙箱执行异常：${reason}`) };
    }
    if (!run.ok) {
      const parts = [`试算失败（阶段=${run.phase}）`];
      if (run.error) parts.push(`${run.error.name}: ${run.error.message}`);
      if (run.hint) parts.push(run.hint);
      if (run.contract?.missingFields.length) {
        parts.push(`缺失/违规字段：${run.contract.missingFields.join('、')}`);
      }
      return { ok: false, outcome: fail(parts.join('；')) };
    }
    const check = validatePluginOutput(run.output, behavior, c.input);
    if (!check.entryFound) {
      return { ok: false, outcome: fail(
        `${c.label} 输出不符合契约：${behavior.contractHint(check)}`
        + `\n请给出修正后的完整源码重新调用 plugin_write（可直接用 plugin_debug 先验算）。`,
      ) };
    }
    // 「能跑但算错也拒」：期望值比对由行为提供，框架不解读语义。
    if (c.expect !== undefined && behavior.matchesExpect !== undefined
      && !behavior.matchesExpect(run.output, c.expect)) {
      return { ok: false, outcome: fail(
        `${c.label} 结果不符：期望 ${JSON.stringify(c.expect)}，实际 ${JSON.stringify(run.output)}`
        + `\n请修正源码或自检样例的期望值后重新给出完整源码。`,
      ) };
    }
    outputs.push(run.output);
  }

  const text = behavior.formatResult(outputs, built.cases);
  const success: TrialSuccess = { ok: true, text, spec };
  if (behavior.artifactContract !== undefined) {
    const ac = behavior.artifactContract({
      ...(options.customInput !== undefined ? { customInput: options.customInput } : {}),
      ...(contract !== undefined ? { contract } : {}),
    });
    if (ac !== undefined) success.artifactContract = ac;
  }
  return success;
}

/** 从工件（或指定历史版本）取源码 */
function codeOf(artifact: PluginArtifact, version?: number): { code: string; label: string } | null {
  if (version === undefined || version === artifact.version) {
    return { code: artifact.code, label: `v${artifact.version}（当前）` };
  }
  const rev: PluginRevision | undefined = artifact.history.find((h) => h.version === version);
  return rev ? { code: rev.code, label: `v${rev.version}（历史）` } : null;
}

async function requireArtifact(deps: PluginToolDeps, id: string): Promise<PluginArtifact | null> {
  try { return await deps.artifacts.get(id); } catch { return null; }
}

// ---------- 工具声明 ----------

const ID_PARAM: Record<string, unknown> = { type: 'string', description: '插件 id（来自 plugin_list / 工具观察）' };
const VERSION_PARAM: Record<string, unknown> = { type: 'number', description: '版本号（整数）；省略表示当前生效版本' };
/**
 * 算子短名形状：逐字复用 SkillRecipe.PRIMITIVE_NAME_RE（宿主原语/算子共享同一命名口径），
 * 不带点是明说的约束 —— `<slug>.<method>` 用第一个点分隔命名空间与方法名。
 * 不是拟合常数：来自既有宿主命名规则。
 */
const OPERATOR_SLUG_RE = /^[a-z][a-z0-9_]*$/;

function buildTools(behaviors: ExtensionPointBehaviorRegistry): ModelToolDefinition[] {
  const pointIdEnum = Object.keys(PLUGIN_SPECS);
  const pointIdDesc = `扩展点；当前可用：${pointIdEnum.join('、')}。${pointIdDescriptionOf(behaviors)}`;
  return [
  {
    name: PLUGIN_TOOL_NAMES.list,
    description: '列出当前全部插件工件（id / 名字 / 版本 / 启用状态 / 原始需求 / 扩展点）。不确定操作对象时先调用。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: PLUGIN_TOOL_NAMES.show,
    description: '读取一个插件的完整源码与元信息；可用 version 查看某个历史版本的源码。',
    parameters: {
      type: 'object',
      properties: { artifactId: ID_PARAM, version: VERSION_PARAM },
      required: ['artifactId'], additionalProperties: false,
    },
  },
  {
    name: PLUGIN_TOOL_NAMES.history,
    description: '查看一个插件的版本链摘要（版本号 / 触发方式 / 时间 / 结果 / 反馈），用于对比或挑选回滚目标。',
    parameters: {
      type: 'object', properties: { artifactId: ID_PARAM },
      required: ['artifactId'], additionalProperties: false,
    },
  },
  {
    name: PLUGIN_TOOL_NAMES.write,
    description:
      '写入一份完整插件源码，自动试算并落库。不带 artifactId = 新建；带 artifactId = 修订该插件并产生新版本。' +
      '这是「创建」和「迭代修改」共用的唯一入口，可反复调用直到结果满意。code 必须是完整 JS 源码字符串。'
      + `入口函数与附加参数由扩展点决定：${pointIdDescriptionOf(behaviors)}`,
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '完整 JS 源码（入口函数按所选扩展点的沙箱契约），不是 diff/片段' },
        artifactId: { type: 'string', description: '要修订的插件 id；省略则新建' },
        intent: { type: 'string', description: '原始需求描述（新建时必填；修订时可省略，沿用原需求）' },
        name: { type: 'string', description: '插件名；仅当用户明确起了名字时给，否则省略' },
        slug: {
          type: 'string',
          description: '可选但写 workflow 算子时强烈建议给：稳定的算子命名空间短名（小写字母开头，'
            + '只允许小写字母/数字/下划线，与宿主原语名同一形状、不带点）。'
            + 'exposes[] 的每个方法会注册成 <slug>.<method>，技能配方的 workflow.steps[].call 就引用这个名字；'
            + '不给则用生成式工件 id，配方无法稳定引用。新建时定，修订时可补正；发布到 weiqi-assets 时映射为 workflow-operator.<slug>。',
        },
        feedback: { type: 'string', description: '本轮修改说明，会记进版本历史' },
        pointId: { type: 'string', enum: pointIdEnum, description: pointIdDesc },
        ...extraParamsOf(behaviors),
      },
      required: ['code'], additionalProperties: false,
    },
  },
  {
    name: PLUGIN_TOOL_NAMES.debug,
    description:
      '对一份源码单独试算：可用 artifactId(+version) 读已存插件，或直接给 code 试未落库的临时源码；' +
      '自定义试算输入由扩展点声明（见对应参数说明），不传则用该扩展点自带的代表性样例。不修改任何工件。',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: '已存插件 id；与 code 二选一' },
        version: VERSION_PARAM,
        code: { type: 'string', description: '临时源码（未落库）；与 artifactId 二选一，优先于 artifactId' },
        ...extraParamsOf(behaviors),
        pointId: { type: 'string', enum: pointIdEnum, description: pointIdDesc },
        ...trialInputParamsOf(behaviors),
      },
      additionalProperties: false,
    },
  },
  {
    name: PLUGIN_TOOL_NAMES.toggle,
    description: '启用或停用插件。enabled 省略则按当前状态翻转。',
    parameters: {
      type: 'object',
      properties: { artifactId: ID_PARAM, enabled: { type: 'boolean', description: 'true=启用，false=停用；省略则翻转' } },
      required: ['artifactId'], additionalProperties: false,
    },
  },
  {
    name: PLUGIN_TOOL_NAMES.delete,
    description: '删除一个插件工件（不可撤销，但在工具调用前请确认 id）。',
    parameters: {
      type: 'object', properties: { artifactId: ID_PARAM },
      required: ['artifactId'], additionalProperties: false,
    },
  },
  {
    name: PLUGIN_TOOL_NAMES.apply,
    description: '把某个已启用且支持页面口径的插件设为当前口径；省略 artifactId = 切回内置。',
    parameters: {
      type: 'object',
      properties: { artifactId: { type: 'string', description: '要应用的插件 id；省略则回到内置' } },
      additionalProperties: false,
    },
  },
  {
    name: PLUGIN_TOOL_NAMES.rollback,
    description: '让插件回到某个历史版本的源码（产生一个新版本，所有旧快照保留）。用 plugin_history 先确认版本号。',
    parameters: {
      type: 'object',
      properties: { artifactId: ID_PARAM, version: { type: 'number', description: '要回到的历史版本号（整数）' } },
      required: ['artifactId', 'version'], additionalProperties: false,
    },
  },
  ];
}

// ---------- 执行器 ----------

export function createPluginToolKit(deps: PluginToolDeps): PluginToolKit {
  const behaviors = deps.behaviors ?? createExtensionPointBehaviors();
  const behaviorOf = (spec: PluginSpec): ExtensionPointBehavior | undefined =>
    resolveExtensionPointBehavior(behaviors, spec.pointId);
  const trialOf = async (
    code: string, spec: PluginSpec,
    options: { customInput?: unknown; contract?: unknown } = {},
  ) => {
    const behavior = behaviorOf(spec);
    if (behavior === undefined) {
      return { ok: false as const, outcome: fail(`扩展点 ${spec.pointId} 未注册行为，无法试算`) };
    }
    return trial(deps, behavior, code, spec, options);
  };
  const executors: Record<string, ToolExecutor> = {};

  executors[PLUGIN_TOOL_NAMES.list] = async () => {
    let artifacts: PluginArtifact[];
    try { artifacts = await deps.artifacts.list(); } catch (e) {
      return fail(`读取插件清单失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (artifacts.length === 0) {
      return ok('当前没有任何插件。', '清单为空');
    }
    const lines = artifacts.map((a) =>
      `- ${a.id} | ${a.name} | v${a.version} | ${a.enabled ? '已启用' : '停用'} | ${a.pointId}`
      + (a.slug !== undefined ? ` | slug=${a.slug}` : '')
      + ` | 需求：${a.intent}`,
    );
    return ok(`当前共 ${artifacts.length} 个插件：\n${lines.join('\n')}`, `列出 ${artifacts.length} 个插件`);
  };

  executors[PLUGIN_TOOL_NAMES.show] = async (argsJson) => {
    const a = readArgs<Record<string, unknown>>(argsJson, 'plugin_show');
    if (!a.ok) return a.failure;
    const id = str(a.value, 'artifactId');
    if (!id) return fail('plugin_show 缺少 artifactId');
    const artifact = await requireArtifact(deps, id);
    if (!artifact) return fail(`找不到插件 ${id}，请先 plugin_list`);
    const picked = codeOf(artifact, num(a.value, 'version'));
    if (!picked) return fail(`插件 ${id} 没有 v${num(a.value, 'version')} 这个版本，请先 plugin_history`);
    const head = [
      `id=${artifact.id}`, `name=${artifact.name}`, `pointId=${artifact.pointId}`,
      `version=${artifact.version}`, `enabled=${artifact.enabled}`, `源码版本=${picked.label}`,
      `intent=${artifact.intent}`,
      ...(artifact.slug !== undefined ? [`slug=${artifact.slug}`] : []),
    ].join(' | ');
    return ok(
      `${head}\n\n【完整源码】\n${picked.code}`,
      `展示 ${artifact.name} ${picked.label}`,
      picked.code,
    );
  };

  executors[PLUGIN_TOOL_NAMES.history] = async (argsJson) => {
    const a = readArgs<Record<string, unknown>>(argsJson, 'plugin_history');
    if (!a.ok) return a.failure;
    const id = str(a.value, 'artifactId');
    if (!id) return fail('plugin_history 缺少 artifactId');
    const artifact = await requireArtifact(deps, id);
    if (!artifact) return fail(`找不到插件 ${id}，请先 plugin_list`);
    const lines = artifact.history.map((h) =>
      `- v${h.version} | ${h.trigger} | ${h.outcome} | ${new Date(h.at).toISOString()} | 代码 ${h.code.length} 字符`
      + (h.feedback ? ` | 反馈：${h.feedback}` : ''),
    );
    return ok(
      `插件 ${artifact.name}（${id}）共 ${artifact.history.length} 个版本：\n${lines.join('\n')}`,
      `列出 ${artifact.history.length} 个版本`,
    );
  };

  executors[PLUGIN_TOOL_NAMES.write] = async (argsJson) => {
    const a = readArgs<Record<string, unknown>>(argsJson, 'plugin_write');
    if (!a.ok) return a.failure;
    const rawCode = str(a.value, 'code');
    if (!rawCode) return fail('plugin_write 缺少 code（必须给完整 JS 源码字符串，不是 diff/片段）');
    const code = normalizeCode(rawCode);
    const id = str(a.value, 'artifactId');
    const slug = str(a.value, 'slug');
    if (slug !== undefined && !OPERATOR_SLUG_RE.test(slug)) {
      return fail(
        `slug「${slug}」不合法：必须小写字母开头、只允许小写字母/数字/下划线（与宿主原语名同形状、不带点）。`
        + '它要拼成 <slug>.<method> 供技能配方引用，点号会破坏分隔。',
        '算子短名不合法',
      );
    }

    // 修订已有工件时，扩展点与契约以工件自身为准：模型不必、也不该在改代码时
    // 换掉 pointId（换扩展点等于换一种插件，应新建）。新建才允许选 pointId。
    // 默认扩展点取注册表第一条，框架不写死任何具体 pointId。
    const defaultSpec = Object.values(PLUGIN_SPECS)[0]!;
    let spec: PluginSpec = defaultSpec;
    let contract: unknown;
    if (id) {
      const existing = await requireArtifact(deps, id);
      if (!existing) return fail(`找不到插件 ${id}，无法修订。请先 plugin_list 确认 id；若是要新建请省略 artifactId`);
      spec = existing.spec ?? resolvePluginSpec(existing.pointId) ?? defaultSpec;
      contract = contractOfArtifact(existing);
      // 允许模型在修订时补正/扩充资源契约；没给就沿用工件里已有的那份。
      const behavior = behaviorOf(spec);
      if (behavior?.parseContract !== undefined) {
        const supplied = behavior.parseContract(a.value);
        if (supplied !== undefined) contract = supplied;
      }
    } else {
      const requested = str(a.value, 'pointId');
      if (requested !== undefined) {
        const resolved = resolvePluginSpec(requested);
        if (resolved === undefined) {
          return fail(
            `未知的 pointId ${requested}。当前可用：${Object.keys(PLUGIN_SPECS).join('、')}`,
            '未知扩展点',
          );
        }
        spec = resolved;
      }
      const behavior = behaviorOf(spec);
      if (behavior?.parseContract !== undefined) contract = behavior.parseContract(a.value);
    }

    const result = await trialOf(code, spec, { ...(contract !== undefined ? { contract } : {}) });
    if (!result.ok) {
      // 试算失败：不落库，失败原因即观察，模型据此在下一轮自行修正（标准 loop）。
      // repairable=true 告诉共用 loop：这次重写是同一次决策的延续，不占决策预算。
      return { ...result.outcome, repairable: true, code };
    }

    try {
      if (!id) {
        const intent = str(a.value, 'intent');
        if (!intent) return fail('新建插件必须给 intent（原始需求描述），请连同 code 一起重新调用', '新建缺 intent');
        const entries = await deps.snapshot.snapshot();
        const name = resolvePluginName(str(a.value, 'name'), entries);
        const created = await deps.artifacts.create({
          name, intent, code, pointId: spec.pointId, origin: 'llm', spec,
          ...(slug !== undefined ? { slug } : {}),
          ...(result.artifactContract !== undefined
            ? { operatorContract: result.artifactContract as OperatorArtifactContract } : {}),
        });
        await deps.onArtifactChange?.();
        const behavior = behaviorOf(spec);
        const label = behavior?.resultLabel ?? '试算结果';
        const opNames = (created.operatorContract?.exposes ?? []).map(
          (e) => `${created.slug ?? created.id}.${e.name}`,
        );
        return ok(
          `已新建插件候选：id=${created.id}，name=${created.name}，扩展点 ${spec.pointId}，`
          + `v${created.version}（默认停用，需用户确认后启用）。\n`
          + (slug !== undefined
            ? `算子命名空间 slug=${slug}；启用后算子名：${opNames.length > 0 ? opNames.join('、') : '<slug>.<method>'}`
              + '（技能配方 workflow.steps[].call 引用这些名字）。\n'
            : '未给 slug：算子名会用生成式工件 id，技能配方无法稳定引用；下次 plugin_write 可补一个 slug。\n')
          + `自动试算通过，${label}：\n${result.text}`,
          `新建 ${created.name} v${created.version}`,
          code,
        );
      }
      const existing = await requireArtifact(deps, id);
      if (!existing) return fail(`找不到插件 ${id}，无法修订。请先 plugin_list 确认 id；若是要新建请省略 artifactId`);
      // 先取一次再窄化：exactOptionalPropertyTypes 下，两次求值会让展开后的
      // feedback 被推成 string | undefined，不能赋给可选的 string。
      const feedback = str(a.value, 'feedback');
      const revised = await deps.artifacts.revise(id, {
        code,
        trigger: 'user-feedback',
        ...(feedback ? { feedback } : {}),
        ...(slug !== undefined ? { slug } : {}),
      });
      // 资源契约随源码版本一起更新；不带契约的扩展点不碰，避免无意义的清空写。
      if (result.artifactContract !== undefined) {
        await deps.artifacts.syncOperatorContract(
          id, result.artifactContract as OperatorArtifactContract | undefined,
        );
      }
      await deps.onArtifactChange?.();
      const behavior = behaviorOf(spec);
      const label = behavior?.revisionResultLabel ?? '本版试算结果';
      return ok(
        `已修订插件 ${revised.name}（${id}）：v${existing.version} → v${revised.version}，版本快照已追加快照链。\n`
        + `自动试算通过，${label}：\n${result.text}`,
        `修订为 v${revised.version}`,
        code,
      );
    } catch (e) {
      return fail(`落库失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  executors[PLUGIN_TOOL_NAMES.debug] = async (argsJson) => {
    const a = readArgs<Record<string, unknown>>(argsJson, 'plugin_debug');
    if (!a.ok) return a.failure;
    let code: string | undefined = str(a.value, 'code');
    let label = '临时源码（未落库）';
    let spec: PluginSpec = Object.values(PLUGIN_SPECS)[0]!;
    let contract: unknown;
    let customInput: unknown;

    if (!code) {
      const id = str(a.value, 'artifactId');
      if (!id) return fail('plugin_debug 需要 code 或 artifactId 至少给一个');
      const artifact = await requireArtifact(deps, id);
      if (!artifact) return fail(`找不到插件 ${id}，请先 plugin_list`);
      const picked = codeOf(artifact, num(a.value, 'version'));
      if (!picked) return fail(`插件 ${id} 没有该版本，请先 plugin_history`);
      code = picked.code;
      label = `${artifact.name} ${picked.label}`;
      spec = artifact.spec ?? resolvePluginSpec(artifact.pointId) ?? Object.values(PLUGIN_SPECS)[0]!;
      contract = contractOfArtifact(artifact);
    } else {
      code = normalizeCode(code);
      const requested = str(a.value, 'pointId');
      if (requested !== undefined) {
        const resolved = resolvePluginSpec(requested);
        if (resolved === undefined) return fail(`未知的 pointId ${requested}`);
        spec = resolved;
      }
      const behavior = behaviorOf(spec);
      if (behavior?.parseContract !== undefined) contract = behavior.parseContract(a.value);
    }

    // 自定义试算输入：参数名由行为声明，框架只按声明取原始值、不解读语义。
    const behavior = behaviorOf(spec);
    if (behavior?.trialInput !== undefined) {
      const raw = a.value[behavior.trialInput.param];
      if (raw !== undefined) customInput = raw;
    }
    const result = await trialOf(code, spec, {
      ...(customInput !== undefined ? { customInput } : {}),
      ...(contract !== undefined ? { contract } : {}),
    });
    if (!result.ok) return { ...result.outcome, repairable: true, code };
    const scope = behavior?.trialScopeLabel(customInput !== undefined) ?? '代表性样例';
    return ok(
      `对 ${label} 用${scope}试算通过（不修改任何工件）：\n${result.text}`,
      `试算 ${label}`,
      code,
    );
  };

  executors[PLUGIN_TOOL_NAMES.toggle] = async (argsJson) => {
    const a = readArgs<Record<string, unknown>>(argsJson, 'plugin_toggle');
    if (!a.ok) return a.failure;
    const id = str(a.value, 'artifactId');
    if (!id) return fail('plugin_toggle 缺少 artifactId');
    const artifact = await requireArtifact(deps, id);
    if (!artifact) return fail(`找不到插件 ${id}，请先 plugin_list`);
    const next = bool(a.value, 'enabled') ?? !artifact.enabled;
    if (next === artifact.enabled) {
      return ok(
        `插件 ${artifact.name}（${id}）原本就${next ? '已启用' : '停用'}，无需变更。`,
        '状态未变',
      );
    }
    try {
      await deps.artifacts.setEnabled(id, next);
      await deps.onArtifactChange?.();
    } catch (e) {
      return fail(`启停失败：${e instanceof Error ? e.message : String(e)}`);
    }
    return ok(
      `已${next ? '启用' : '停用'}插件 ${artifact.name}（${id}）。`,
      `${next ? '启用' : '停用'} ${artifact.name}`,
    );
  };

  executors[PLUGIN_TOOL_NAMES.delete] = async (argsJson) => {
    const a = readArgs<Record<string, unknown>>(argsJson, 'plugin_delete');
    if (!a.ok) return a.failure;
    const id = str(a.value, 'artifactId');
    if (!id) return fail('plugin_delete 缺少 artifactId');
    const artifact = await requireArtifact(deps, id);
    if (!artifact) return fail(`找不到插件 ${id}，请先 plugin_list`);
    try {
      await deps.artifacts.remove(id);
      await deps.onArtifactChange?.();
    } catch (e) {
      return fail(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
    return ok(`已删除插件 ${artifact.name}（${id}）。`, `删除 ${artifact.name}`);
  };

  executors[PLUGIN_TOOL_NAMES.apply] = async (argsJson) => {
    const a = readArgs<Record<string, unknown>>(argsJson, 'plugin_apply');
    if (!a.ok) return a.failure;
    const id = str(a.value, 'artifactId');
    if (!id) {
      try {
        await deps.applySelection(undefined);
      } catch (e) {
        return fail(`切回内置口径失败：${e instanceof Error ? e.message : String(e)}`);
      }
      return ok('已切回内置口径（清除赛事页的插件选择）。', '切回内置口径');
    }
    const artifact = await requireArtifact(deps, id);
    if (!artifact) return fail(`找不到插件 ${id}，请先 plugin_list`);
    const behavior = resolveExtensionPointBehavior(behaviors, artifact.pointId);
    if (behavior === undefined || !behavior.supportsApplySelection) {
      return fail(
        `插件 ${artifact.name} 的扩展点 ${artifact.pointId} 不支持设为页面当前口径。`,
      );
    }
    if (!artifact.enabled) {
      return fail(`插件 ${artifact.name} 目前停用。请先用 plugin_toggle 启用，再执行 plugin_apply。`);
    }
    try {
      await deps.applySelection(id);
    } catch (e) {
      return fail(`应用失败：${e instanceof Error ? e.message : String(e)}`);
    }
    return ok(
      `已把插件 ${artifact.name}（${id}，v${artifact.version}）设为${behavior.label}当前口径。`,
      `应用 ${artifact.name}`,
    );
  };

  executors[PLUGIN_TOOL_NAMES.rollback] = async (argsJson) => {
    const a = readArgs<Record<string, unknown>>(argsJson, 'plugin_rollback');
    if (!a.ok) return a.failure;
    const id = str(a.value, 'artifactId');
    const version = num(a.value, 'version');
    if (!id) return fail('plugin_rollback 缺少 artifactId');
    if (version === undefined || !Number.isInteger(version) || version < 1) {
      return fail('plugin_rollback 需要正整数 version（先用 plugin_history 确认版本号）');
    }
    const artifact = await requireArtifact(deps, id);
    if (!artifact) return fail(`找不到插件 ${id}，请先 plugin_list`);
    const picked = codeOf(artifact, version);
    if (!picked) return fail(`插件 ${id} 没有 v${version}，请先 plugin_history`);
    // 回滚与新建/修订同构：历史源码也要过同一确定性验收，不合规就不落库。
    // 按工件自身的扩展点分派：用例与验收口径由行为注册表提供。
    const spec = artifact.spec ?? resolvePluginSpec(artifact.pointId) ?? Object.values(PLUGIN_SPECS)[0]!;
    const behavior = behaviorOf(spec);
    const result = await trialOf(picked.code, spec, {
      ...(artifact.operatorContract !== undefined ? { contract: artifact.operatorContract } : {}),
    });
    if (!result.ok) return { ...result.outcome, repairable: true, code: picked.code };
    try {
      const revised = await deps.artifacts.revise(id, {
        code: picked.code,
        trigger: 'manual',
        feedback: `回滚到 v${version}`,
      });
      await deps.onArtifactChange?.();
      return ok(
        `已把插件 ${revised.name}（${id}）回滚到 v${version} 的源码，产生新版本 v${revised.version}（旧快照全部保留）。\n`
        + `自动试算通过，${behavior?.resultLabel ?? '试算结果'}：\n${result.text}`,
        `回滚为 v${revised.version}`,
        picked.code,
      );
    } catch (e) {
      return fail(`回滚落库失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 只读准备工具统一标记 preparatory：只是给工具打「查资料」的性质标签，
  // 不是编排模型的步骤顺序（决策权仍在模型）。放这里包一层，避免每个 return 点漏标。
  // debug 试算失败已带 repairable（要重写，续的是修复串），优先级更高，不覆盖。
  const READ_ONLY_TOOLS: readonly string[] = [
    PLUGIN_TOOL_NAMES.list, PLUGIN_TOOL_NAMES.show,
    PLUGIN_TOOL_NAMES.history, PLUGIN_TOOL_NAMES.debug,
  ];
  for (const name of READ_ONLY_TOOLS) {
    const inner = executors[name]!;
    executors[name] = async (argsJson: string) => {
      const out = await inner(argsJson);
      return out.repairable ? out : { ...out, preparatory: true };
    };
  }

  return {
    tools: buildTools(behaviors),
    executors,
    systemPrompt: () => buildSystemPrompt(deps.snapshot, behaviors),
    maxTurns: Math.max(1, deps.maxAttempts ?? DEFAULT_PLUGIN_MAX_ATTEMPTS) + 1,
  };
}