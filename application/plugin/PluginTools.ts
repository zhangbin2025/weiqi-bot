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
 * 一切操作都是工具：调试(试算)、历史、回滚、启停、删除、应用为排名实现。
 * 执行器与 UI 面板共用同一批 service，消除「模型一套、按钮一套」的分裂。
 *
 * 数值口径：沙箱 limits 沿用 RANKING_SPEC，样例输入沿用 SAMPLE_RANKING_INPUT，
 * 输出契约校验沿用 validateRankingOutput。本文件不引入任何新阈值/经验常数。
 */

import type { ModelToolDefinition } from '../model/IModelGateway';
import type { ToolOutcome, ToolExecutor } from '../chat/ToolLoop';
import {
  RANKING_SPEC, RANKING_POINT_ID, LLM_TOOL_SPEC, LLM_TOOL_POINT_ID,
  resolvePluginSpec, PLUGIN_SPECS,
  type IPluginRuntime, type PluginArtifact, type PluginRevision,
  type PluginContextEntry, type PluginRunResult, type PluginSpec,
  type LlmToolArtifactContract,
} from '@domain/plugin/types';
import { SAMPLE_RANKING_INPUT, validateRankingOutput } from '@domain/ranking';
import { validatePluginOutput } from '@domain/plugin/PluginValidator';
import {
  validateLlmToolContract, llmToolTrialCases, deepEqual,
} from './LlmToolContract';
import type { RankingInput, RankingOutput, MatchData } from '@domain/ranking/types';
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
   * 赛事页「当前选中的排名插件」持久化。undefined = 切回内置。
   * 由装配根提供，工具集不依赖具体存储实现。
   */
  applySelection: (artifactId: string | undefined) => Promise<void>;
  /** 可选：/llm repairs 配置的自动修复轮数；工具集换算成 loop 的总决策轮数上限 */
  maxAttempts?: number;
}

export interface PluginToolKit {
  tools: ModelToolDefinition[];
  executors: Record<string, ToolExecutor>;
  /** 每轮 turn 动态生成：实时读工件清单，不依赖会话历史 */
  systemPrompt: () => Promise<string>;
  /** 自主决策轮数上限 = maxAttempts + 1；修复延续不占此预算（见 ToolLoop.ts） */
  maxTurns: number;
}

// ---------- 契约文本（沿用 11-13 已确认的口径，不另立解释、不改数值） ----------

const CONTRACT_LINES = [
  '- 入口固定为 rank(input)，input 只有 { matches: [...] }，matches 是最原始的对阵表。',
  '- 每场含 bout/table/p1Id/p1Name/p1Score/p2Id/p2Name/p2Score；胜=2、负=0、和=1。',
  '- 积分、对手分、累进分、逆减、胜局等一切中间量都要自己从 matches 算，宿主不代算、不预置字段。',
  '- 必须返回 { columns, rows }：columns 是 [{key,label}]，key 为英文标识符，label 只能是 1~12 个汉字；',
  '  rows 是 [{id,name,rank,cells}]，id/name 必须与对阵表里的选手完全一致，rank 为数值名次。',
  '- cells 里每列的值只能是「有限数值」或「元素全为有限数值的数组」（如逐轮逆减 [3,12] 显示 3-12），',
  '  不支持字符串、HTML、null、对象或其它格式；rank/name/id 是宿主保留的只读结构列，不在 cells 里、不能出现在 columns 里。',
  '  columns 声明的每一个 key，都必须在每一行的 cells 里都有对应的合法值；',
  '  只给部分行填某一列、或漏填，都会导致整份输出不通过校验。建议先构造齐所有行再统一填 cells。',
  '- 显示哪些列、叫什么、顺序、值全部由 columns + cells 决定，插件可自由加列删列改名。',
  '- 轮空：p1Id/p2Id 为 0 或姓名为空的一侧不是选手、不进 rows，但另一侧比分照常计入；',
  '  双方比分全 0 = 未完赛。rows 必须恰好覆盖对阵表里全部真实选手，不能多不能少。',
].join('\n');

const LLM_TOOL_DEV_LINES = [
  '- 除了排名插件，也可以写「能力库」（llm-tool）：给闲聊角色增加一个可调用的纯计算函数，',
  '  例如单位换算、日期换算、编码解码。写这类插件时 plugin_write 要带 pointId:"llm-tool"，',
  '  并且同时给 exposes[]（方法白名单）与 smoke[]（自检样例 + 期望结果）。',
  '- 能力库源码入口固定为 function call(input)，input 是 { method, args }：',
  '  method 只能取 exposes[].name，args 是参数数组；返回任意可 JSON 序列化的值。',
  '  方法实现建议挂在源码自己的对象上，用白名单查表调用，绝不要用 eval / new Function。',
  '- exposes[] 每项：{ name: 合法方法标识符, description: 一句话说明, params: 参数 JSON Schema }。',
  '  params 会原样进入闲聊角色 system 的工具清单，模型照它填参数。',
  '- smoke[] 每项：{ method?(可省略,默认 exposes[0]), args:[一个参数对象], expect: 期望返回值 }。',
  '  宿主逐条跑沙箱并与 expect 逐字段比对，能跑但算错也拒；样例请用确定性输入，',
  '  不要依赖当前时间 / 随机数。',
  '- 写完默认停用，必须用户到「本地插件」人工启用；启用后闲聊与技能开发角色都能调用。',
  '  库源码不进模型上下文、不进页面 JS 环境，只在一次性 QuickJS Worker 里执行。',
].join('\n');

const TOOL_GUIDE = [
  '- plugin_list：查看当前全部插件（id / 名字 / 版本 / 启用状态 / 原始需求）。不确定改哪个时先调它。',
  '- plugin_show：读某个插件的完整源码，可带 version 看历史版本。',
  '- plugin_history：看某个插件的版本链摘要（版本号 / 触发 / 时间 / 反馈）。',
  '- plugin_write：写入一份完整源码。不带 artifactId = 新建；带 artifactId = 修订该插件、',
  '  自动产生新版本并追加快照。参数 code 是完整 JS 源码字符串，不是 diff、不是片段。',
  '  宿主会用代表性对阵样例自动试算并把结果回填给你；试算失败则不落库。',
  '  写能力库时另带 pointId:"llm-tool" + exposes[] + smoke[]，宿主改跑自检样例。',
  '- plugin_debug：对任意源码单独试算。可指定 artifactId(+version) 读已存插件、或直接给 code 试未落库的临时源码；',
  '  matches 可自定义对阵表，不传则用内置样例。返回排名表或明确错误诊断。',
  '  调试 llm-tool 时把 artifactId 指向能力库工件，或给 code 并带 exposes[]/smoke[]；matches 不适用。',
  '- plugin_toggle：启用/停用插件，enabled 省略则按当前状态翻转。',
  '- plugin_delete：删除插件。',
  '- plugin_apply：把某个已启用的排名插件设为赛事页当前口径；省略 artifactId = 切回内置排名。',
  '- plugin_rollback：让插件回到某个历史版本（产生一个新版本，旧快照都保留）。',
].join('\n');

/** 动态 system：清单实时来自工件存储，与会话历史无关 */
async function buildSystemPrompt(snapshot: PluginContextProvider): Promise<string> {
  let list = '（当前没有任何插件）';
  try {
    const entries: PluginContextEntry[] = await snapshot.snapshot();
    if (entries.length > 0) {
      list = entries.map((p) =>
        `- ${p.id} | ${p.name} | 扩展点 ${p.pointId} | ${p.enabled ? '已启用' : '停用'} | v${p.version} | 需求：${p.intent}`,
      ).join('\n');
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    list = `（清单读取失败：${reason}；可再试 plugin_list）`;
  }

  return [
    '你是围棋客户端里的可编程智能体，通过工具真实地查看、编写、修改、试算、启停插件。',
    '插件是自定义排名规则的纯 JavaScript 计算函数，在沙箱里执行，无网络、无存储、无 DOM、无定时器，禁止 require/import/eval。',
    '',
    '【当前插件清单】',
    list,
    '',
    '【沙箱契约】插件与内置排名共用一套机制：',
    CONTRACT_LINES,
    '',
    '【能力库开发（llm-tool 扩展点）】写排名插件时下面这段不适用，按上面的沙箱契约来：',
    LLM_TOOL_DEV_LINES,
    '',
    '【可用工具】',
    TOOL_GUIDE,
    '',
    '【迭代开发】改插件就是再调一次 plugin_write 并带上 artifactId，和新建走完全相同的路径：',
    '每次写入都会自动试算，观察里会返回这一版的排名表（能力库则是自检结果）。看结果不满意、或用户提出新要求，',
    '就调 plugin_show 读当前源码 → 按新要求改 → 再 plugin_write，如此反复直到收敛。',
    '不要用会话记忆猜源码或 id：用 plugin_list / plugin_show 的真实观察。',
    '需要验算特定对阵时用 plugin_debug 自定义 matches；调试能力库临时源码时给 pointId:"llm-tool" 加 exposes/smoke；'
    + '要对比/回退用 plugin_history / plugin_rollback。',
    '',
    '【状态变更铁律】查看/启停/删除/新建/修订都必须真的调用对应工具，不能只在回复里声称完成。',
    '只有收到工具观察回执后，才能在最终回复里确认状态。用户说「启用」就调 plugin_toggle + enabled:true，',
    '说「停用」就 enabled:false；不知道指哪个插件时先 plugin_list，不要凭记忆编 id。',
    '新建/修订产生的候选默认停用，用户确认后才启用。',
    '【命名】只有用户明确给规则起了名字时才传 name；否则省略，系统自动排号，不要自己编花哨名字。',
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

/** llm-tool 契约参数：只做形状读取，合法性交给 validateLlmToolContract 统一判定 */
function llmToolContractOf(args: Record<string, unknown>): LlmToolArtifactContract | undefined {
  const exposes = args['exposes'];
  const smoke = args['smoke'];
  if (exposes === undefined && smoke === undefined) return undefined;
  return {
    exposes: Array.isArray(exposes) ? exposes as LlmToolArtifactContract['exposes'] : [],
    smoke: Array.isArray(smoke) ? smoke as LlmToolArtifactContract['smoke'] : [],
  };
}

/** 从工件读 llm-tool 契约；缺失时明确报错（自建能力库必须带契约才能被闲聊角色调用） */
function contractOfArtifact(artifact: PluginArtifact): LlmToolArtifactContract | undefined {
  return artifact.llmTool;
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

/** 把 {columns, rows} 渲染成人能看懂的表格文本，作为工具观察 */
function formatRankingTable(output: RankingOutput): string {
  const labels = output.columns.map((c) => c.label);
  const head = ['名次', '姓名', ...labels].join(' | ');
  const lines = output.rows.map((row) => {
    const cells = output.columns.map((c) => {
      const v = row.cells[c.key];
      if (v === undefined) return '-';
      return Array.isArray(v) ? v.join('-') : String(v);
    });
    return [String(row.rank), row.name, ...cells].join(' | ');
  });
  return [head, ...lines].join('\n');
}

/** 自定义 matches 的轻量校验：只查结构，不新造业务口径；不合法明确告知模型 */
function parseMatches(raw: unknown): { ok: true; input: RankingInput } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: 'matches 必须是数组' };
  const required = ['bout', 'p1Id', 'p1Name', 'p1Score', 'p2Id', 'p2Name', 'p2Score'] as const;
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i] as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return { ok: false, reason: `matches[${i}] 不是对象` };
    for (const k of required) {
      if (m[k] === undefined) return { ok: false, reason: `matches[${i}] 缺少 ${k}` };
    }
    if (typeof m['p1Name'] !== 'string' || typeof m['p2Name'] !== 'string'
      || typeof m['p1Id'] !== 'number' || typeof m['p2Id'] !== 'number'
      || typeof m['p1Score'] !== 'number' || typeof m['p2Score'] !== 'number'
      || typeof m['bout'] !== 'number') {
      return { ok: false, reason: `matches[${i}] 字段类型不对（bout/p1Id/p2Id/p1Score/p2Score 应为数值，姓名应为字符串）` };
    }
  }
  return { ok: true, input: { matches: raw as MatchData[] } };
}

/**
 * 一次确定性试算：快筛 → 沙箱 → 输出契约校验。返回结构化观察，不引入模型判定。
 *
 * 按 spec.pointId 分派，两条链路共用同一个沙箱与同一套配额：
 * - ranking：代表性对阵样例 → validateRankingOutput → 表格文本；
 * - llm-tool：逐条跑声明的 smoke[]，比对 expect → 结果摘要文本。
 * 契约（exposes/smoke）由调用方传入，模型给的参数只作为 JSON 数据，不拼进代码。
 */
interface TrialSuccess {
  ok: true;
  /** 回填给模型的观察文本（ranking 是表格，llm-tool 是自检结果摘要） */
  text: string;
  /** ranking 试算的表格，仅 ranking 分支有值 */
  table?: RankingOutput;
  /** 本次写入/调试实际用的 spec，落库时透传给工件 */
  spec: PluginSpec;
  /** llm-tool 写入时要随工件持久化的契约 */
  llmTool?: LlmToolArtifactContract;
}

async function trial(
  deps: PluginToolDeps,
  code: string,
  spec: PluginSpec,
  options: {
    matches?: RankingInput;
    contract?: LlmToolArtifactContract;
  } = {},
): Promise<TrialSuccess | { ok: false; outcome: ToolOutcome }> {
  const pre = deps.validator.validate(code, spec);
  if (!pre.ok) {
    return { ok: false, outcome: fail(`代码预检未通过：${pre.reason ?? '不合法'}。请修正后重新给出完整源码。` ) };
  }

  if (spec.pointId === RANKING_POINT_ID) {
    const input = options.matches ?? SAMPLE_RANKING_INPUT;
    let run: PluginRunResult;
    try {
      run = await deps.runtime.run(code, input, spec);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, outcome: fail(`沙箱执行异常：${reason}`) };
    }
    if (!run.ok) {
      // 直接读沙箱结果的公开字段，不再经 RepairFeedback 的 attempt/maxAttempts
      // （新架构没有「第几次修复」的概念，1/1 那种占位数字没有清楚来源，不能留）。
      const parts = [`试算失败（阶段=${run.phase}）`];
      if (run.error) parts.push(`${run.error.name}: ${run.error.message}`);
      if (run.hint) parts.push(run.hint);
      if (run.contract?.missingFields.length) {
        parts.push(`缺失/违规字段：${run.contract.missingFields.join('、')}`);
      }
      return { ok: false, outcome: fail(parts.join('；')) };
    }
    const check = validateRankingOutput(run.output, input);
    if (!check.ok) {
      // check.hint 来自唯一校验管线，含具体行/列定位（确定性信息，不是模型 verifier）。
      // 原样带出，不再自己拼一句笼统结论，模型才能一次改对。
      return { ok: false, outcome: fail(
        `输出不符合契约（${check.missingFields.join('、')}）：${check.hint ?? '必须返回 { columns, rows }'}`
        + `\n请给出修正后的完整源码重新调用 plugin_write（可直接用 plugin_debug 带同一份 code 先验算）。`,
      ) };
    }
    const table = run.output as RankingOutput;
    return { ok: true, table, text: formatRankingTable(table), spec };
  }

  // llm-tool：契约快筛 → 逐条 smoke。能跑但算错也拒（与 catalog 安装同一口径）。
  const contract = options.contract;
  const bad = validateLlmToolContract(contract);
  if (bad !== undefined) {
    return { ok: false, outcome: fail(`llm-tool 契约不合法：${bad}。请在 plugin_write 里给出 exposes[] 与 smoke[]。` ) };
  }
  const validContract = contract as LlmToolArtifactContract;
  const cases = llmToolTrialCases(validContract);
  const lines: string[] = [];
  for (const [index, c] of cases.entries()) {
    let run: PluginRunResult;
    try {
      run = await deps.runtime.run(code, { method: c.method, args: c.args }, spec);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, outcome: fail(`沙箱执行异常：${reason}`) };
    }
    if (!run.ok) {
      return { ok: false, outcome: fail(
        `自检样例 ${index + 1} 试算失败（阶段=${run.phase}）：${run.error?.message ?? '未知错误'}`
        + (run.hint ? `；${run.hint}` : ''),
      ) };
    }
    const check = validatePluginOutput(run.output, spec);
    if (!check.entryFound) {
      return { ok: false, outcome: fail(
        `自检样例 ${index + 1} 输出不符合契约：${check.missingFields.join('、') || '未知原因'}`,
      ) };
    }
    if (!deepEqual(run.output, c.expect)) {
      return { ok: false, outcome: fail(
        `自检样例 ${index + 1} 结果不符：期望 ${JSON.stringify(c.expect)}，实际 ${JSON.stringify(run.output)}`
        + `\n请修正源码或 smoke[].expect 后重新给出完整源码。`,
      ) };
    }
    lines.push(`- ${c.method}：${JSON.stringify(run.output)}`);
  }
  return {
    ok: true,
    text: `自检 ${cases.length} 条全部通过：\n${lines.join('\n')}`,
    spec,
    llmTool: validContract,
  };
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

const TOOLS: ModelToolDefinition[] = [
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
      + '省略 pointId 写排名插件；给 "llm-tool" 时另带 exposes[] 与 smoke[] 写能力库。',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '完整 JS 源码，入口 function rank(input)，返回 { columns, rows }；不是 diff/片段' },
        artifactId: { type: 'string', description: '要修订的插件 id；省略则新建' },
        intent: { type: 'string', description: '原始需求描述（新建时必填；修订时可省略，沿用原需求）' },
        name: { type: 'string', description: '插件名；仅当用户明确起了名字时给，否则省略' },
        feedback: { type: 'string', description: '本轮修改说明，会记进版本历史' },
        pointId: {
          type: 'string',
          enum: Object.keys(PLUGIN_SPECS),
          description: '扩展点；省略=ranking（排名插件）。写能力库时给 "llm-tool"',
        },
        exposes: {
          type: 'array',
          description: 'llm-tool 专用：方法白名单 [{name,description,params}]；写能力库时必填',
          items: { type: 'object' },
        },
        smoke: {
          type: 'array',
          description: 'llm-tool 专用：自检样例 [{method?,args:[参数],expect}]；写能力库时必填',
          items: { type: 'object' },
        },
      },
      required: ['code'], additionalProperties: false,
    },
  },
  {
    name: PLUGIN_TOOL_NAMES.debug,
    description:
      '对一份源码单独试算：可用 artifactId(+version) 读已存插件，或直接给 code 试未落库的临时源码；' +
      'matches 可自定义对阵表，不传则用内置代表性样例。返回排名表或明确错误诊断，不修改任何工件。',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: '已存插件 id；与 code 二选一' },
        version: VERSION_PARAM,
        code: { type: 'string', description: '临时源码（未落库）；与 artifactId 二选一，优先于 artifactId' },
        exposes: {
          type: 'array',
          description: 'llm-tool 专用：临时源码的方法白名单；调试能力库时与 smoke 一起给',
          items: { type: 'object' },
        },
        smoke: {
          type: 'array',
          description: 'llm-tool 专用：临时源码的自检样例；调试能力库时与 exposes 一起给',
          items: { type: 'object' },
        },
        pointId: {
          type: 'string',
          enum: Object.keys(PLUGIN_SPECS),
          description: '临时源码的扩展点；给 code 试算能力库时必须给 "llm-tool"（省略=ranking，会忽略 exposes/smoke）',
        },
        matches: {
          type: 'array',
          description: '自定义对阵表；省略则用内置样例。每项含 bout/p1Id/p1Name/p1Score/p2Id/p2Name/p2Score',
          items: {
            type: 'object',
            properties: {
              bout: { type: 'number' }, table: { type: 'number' },
              p1Id: { type: 'number' }, p1Name: { type: 'string' }, p1Score: { type: 'number' },
              p2Id: { type: 'number' }, p2Name: { type: 'string' }, p2Score: { type: 'number' },
            },
            required: ['bout', 'p1Id', 'p1Name', 'p1Score', 'p2Id', 'p2Name', 'p2Score'],
          },
        },
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
    description: '把某个已启用的排名插件设为赛事页当前排名口径；省略 artifactId = 切回内置排名。',
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

// ---------- 执行器 ----------

export function createPluginToolKit(deps: PluginToolDeps): PluginToolKit {
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
      `- ${a.id} | ${a.name} | v${a.version} | ${a.enabled ? '已启用' : '停用'} | ${a.pointId} | 需求：${a.intent}`,
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

    // 修订已有工件时，扩展点与契约以工件自身为准：模型不必、也不该在改代码时
    // 换掉 pointId（换扩展点等于换一种插件，应新建）。新建才允许选 pointId。
    let spec: PluginSpec = RANKING_SPEC;
    let contract: LlmToolArtifactContract | undefined;
    if (id) {
      const existing = await requireArtifact(deps, id);
      if (!existing) return fail(`找不到插件 ${id}，无法修订。请先 plugin_list 确认 id；若是要新建请省略 artifactId`);
      spec = existing.spec ?? resolvePluginSpec(existing.pointId) ?? RANKING_SPEC;
      contract = contractOfArtifact(existing);
      if (spec.pointId === LLM_TOOL_POINT_ID) {
        const supplied = llmToolContractOf(a.value);
        // 允许模型在修订时补正/扩充契约；没给就沿用工件里已有的那份。
        if (supplied !== undefined) contract = supplied;
      }
    } else {
      const requested = str(a.value, 'pointId');
      if (requested !== undefined) {
        const resolved = resolvePluginSpec(requested);
        if (resolved === undefined) {
          return fail(
            `未知的 pointId ${requested}。当前可用：${Object.keys(PLUGIN_SPECS).join('、')}；`
            + '省略则默认 ranking',
            '未知扩展点',
          );
        }
        spec = resolved;
      }
      if (spec.pointId === LLM_TOOL_POINT_ID) contract = llmToolContractOf(a.value);
    }

    const result = await trial(deps, code, spec, { ...(contract !== undefined ? { contract } : {}) });
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
          ...(result.llmTool !== undefined ? { llmTool: result.llmTool } : {}),
        });
        const label = spec.pointId === RANKING_POINT_ID ? '排名表' : '自检结果';
        return ok(
          `已新建插件候选：id=${created.id}，name=${created.name}，扩展点 ${spec.pointId}，`
          + `v${created.version}（默认停用，需用户确认后启用）。\n`
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
      });
      // 契约随源码版本一起更新（能力库改了方法白名单/样例，不能停在旧值）。
      // ranking 工件本就不带契约，不去碰它，避免一次无意义的清空写。
      if (spec.pointId === LLM_TOOL_POINT_ID) {
        await deps.artifacts.syncLlmToolContract(id, result.llmTool);
      }
      const label = spec.pointId === RANKING_POINT_ID ? '本版排名表' : '本版自检结果';
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
    let spec: PluginSpec = RANKING_SPEC;
    let contract: LlmToolArtifactContract | undefined;
    let matches: RankingInput | undefined;

    if (!code) {
      const id = str(a.value, 'artifactId');
      if (!id) return fail('plugin_debug 需要 code 或 artifactId 至少给一个');
      const artifact = await requireArtifact(deps, id);
      if (!artifact) return fail(`找不到插件 ${id}，请先 plugin_list`);
      const picked = codeOf(artifact, num(a.value, 'version'));
      if (!picked) return fail(`插件 ${id} 没有该版本，请先 plugin_history`);
      code = picked.code;
      label = `${artifact.name} ${picked.label}`;
      spec = artifact.spec ?? resolvePluginSpec(artifact.pointId) ?? RANKING_SPEC;
      contract = contractOfArtifact(artifact);
    } else {
      code = normalizeCode(code);
      const requested = str(a.value, 'pointId');
      if (requested !== undefined) {
        const resolved = resolvePluginSpec(requested);
        if (resolved === undefined) return fail(`未知的 pointId ${requested}`);
        spec = resolved;
      }
      if (spec.pointId === LLM_TOOL_POINT_ID) contract = llmToolContractOf(a.value);
    }

    if (spec.pointId === RANKING_POINT_ID) {
      const rawMatches = a.value['matches'];
      if (rawMatches !== undefined) {
        const parsed = parseMatches(rawMatches);
        if (!parsed.ok) return fail(`plugin_debug 的 ${parsed.reason}`);
        matches = parsed.input;
      }
    }
    const result = await trial(deps, code, spec, {
      ...(matches !== undefined ? { matches } : {}),
      ...(contract !== undefined ? { contract } : {}),
    });
    if (!result.ok) return { ...result.outcome, repairable: true, code };
    const scope = spec.pointId === RANKING_POINT_ID
      ? (matches === undefined ? '内置代表性样例' : '自定义对阵表')
      : `${result.text.split('\n')[0]}`;
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
        return fail(`切回内置排名失败：${e instanceof Error ? e.message : String(e)}`);
      }
      return ok('已切回内置排名（清除赛事页的插件选择）。', '切回内置排名');
    }
    const artifact = await requireArtifact(deps, id);
    if (!artifact) return fail(`找不到插件 ${id}，请先 plugin_list`);
    if (artifact.pointId !== RANKING_POINT_ID) {
      return fail(
        `插件 ${artifact.name} 的扩展点是 ${artifact.pointId}，不是 ${RANKING_POINT_ID}，不能设为排名口径。`,
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
      `已把插件 ${artifact.name}（${id}，v${artifact.version}）设为赛事页当前排名口径。`,
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
    // 按工件自身的扩展点分派：能力库要跑 smoke，不是排名样例。
    const spec = artifact.spec ?? resolvePluginSpec(artifact.pointId) ?? RANKING_SPEC;
    const result = await trial(deps, picked.code, spec, {
      ...(artifact.llmTool !== undefined ? { contract: artifact.llmTool } : {}),
    });
    if (!result.ok) return { ...result.outcome, repairable: true, code: picked.code };
    try {
      const revised = await deps.artifacts.revise(id, {
        code: picked.code,
        trigger: 'manual',
        feedback: `回滚到 v${version}`,
      });
      return ok(
        `已把插件 ${revised.name}（${id}）回滚到 v${version} 的源码，产生新版本 v${revised.version}（旧快照全部保留）。\n`
        + `自动试算通过，${spec.pointId === RANKING_POINT_ID ? '排名表' : '自检结果'}：\n${result.text}`,
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
    tools: TOOLS,
    executors,
    systemPrompt: () => buildSystemPrompt(deps.snapshot),
    maxTurns: Math.max(1, deps.maxAttempts ?? DEFAULT_PLUGIN_MAX_ATTEMPTS) + 1,
  };
}