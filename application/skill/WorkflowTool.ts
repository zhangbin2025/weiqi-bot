/**
 * 阶段二 `run_workflow` 工具：把带 `workflow` 声明的配方挂进 ToolLoop。
 * @module application/skill/WorkflowTool
 *
 * 触发形态（契约「触发接线」/ 条款 10）：路由命中 → 模型 `run_workflow({skillId, inputs})`
 * 填 inputs → 宿主跑完 DAG → 结果走 effects 旁路直接交付用户 → 模型只收「完成 + 句柄」。
 * 业务数据不进模型上下文（successObservation 不序列化任何 value）；确定性步骤 0 次模型调用。
 *
 * 与散文路径**并列**（B 决策）：`buildSkillToolParts` 原样保留，本文件只是在
 * 同一 `ToolKit` 追加一个新工具；两类配方走同一个 ToolLoop、同一批基础能力，
 * 但不共享执行语义。没有 workflow 配方的轮次不挂（零额外 token）。
 *
 * effects 落地选**方案②（合并单值）**，理由（最小改动、零回归）：
 * - 契约允许 ① 给 `ToolOutcome`/`ToolLoopResult` 加 effects[] 并改所有落地点 + 测试，
 *   或 ② runner 合并成单值；明确「方案②（合并单值）优先」。
 * - 现有 `ToolLoop` / `ToolOutcome` / `ToolLoopResult` / `ChatUseCase.renderMessage`
 *   / `ChatPage.renderSession` 全链路都是**单值** `actionLink`/`displayMarkdown`；
 *   方案①要改 ToolLoop + ChatUseCase + ChatPage + 多个既有测试，工作量大、易回归。
 * - 方案②不丢数据：多段 `displayMarkdown` 用 `'\n\n'` 全量拼进一个字符串
 *   （顺序 = 节点执行顺序）；`actionLink` 取 effects 里**最后一个非空 url**。
 * - label 来源写清：`StepResult.effects[].actionLink` 只是 url 字符串
 *   （OperatorRegistry 丢了 label），本工具优先用模型 args 里的 `inputs.label`
 *   （若模型给了字符串），否则用配方的 `skill.name`——不凭空编一个 label。
 *   固定兜底也写死在常量里，来源 = 配方的展示名，不是新业务常数。
 *
 * 不置位 `preparatory` / `repairable`：workflow 是实质动作，占一次决策。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { PluginTraceStep } from '@domain/plugin/types';
import type { OperatorRegistry } from '@application/plugin/OperatorRegistry';
import type { ToolOutcome, ToolExecutor } from '@application/chat/ToolLoop';
import type { SkillRecipe, WorkflowInput } from '@application/skill/SkillTypes';
import { runWorkflow, type WorkflowRunResult } from './WorkflowRunner';

/** 形状对齐 SkillRegistry.ChatToolKitParts（同一 ToolKit 拼装口径）。 */
export interface WorkflowToolParts {
  tools: ModelToolDefinition[];
  executors: Record<string, ToolExecutor>;
}

export const RUN_WORKFLOW_TOOL_NAME = 'run_workflow';

/** 静态兜底定义（无 active workflow 配方时不会挂；保留导出供测试/静态引用）。 */
export const RUN_WORKFLOW_TOOL: ModelToolDefinition = {
  name: RUN_WORKFLOW_TOOL_NAME,
  description:
    '按技能的 workflow 声明由宿主一次跑完确定性 DAG（取数 / 提取 / 渲染 / 历法计算等），'
    + '调用前先在本轮可用技能里找带 workflow 的 skillId，并按该技能 inputs 契约填 inputs。'
    + '宿主按声明顺序执行：结果由宿主旁路（展示块 / 动作链接）直接交付用户，'
    + '你只会收到「完成 + 结果位置（句柄）」，不会拿到结果内容；'
    + '失败即短路并把「哪个节点 / 什么错 / 已完成节点」结构化回灌；'
    + '不要自己逐步调用底层工具，也不要复述、归纳或凭空补写结果内容。',
  parameters: {
    type: 'object',
    properties: {
      skillId: { type: 'string', description: '带 workflow 声明的技能 id（见本轮可用技能）' },
      inputs: {
        type: 'object',
        description: '按该技能 inputs 契约填空的参数对象；缺省由配方声明的 default 补齐',
      },
    },
    required: ['skillId'],
  },
};

/**
 * 把本轮 active 的 workflow 配方 id + inputs 契约拼进 description。
 * 路由目录（SkillRouter）给触发条件、这里给填参契约，两者合起来就是模型在
 * workflow 路径需要的全部信息；buildSkillSystemPrompt 已不再为 workflow 配方注入
 * summary + prompt + 尾句（2026-11-23 收窄）。这属于数据披露、不是新策略；
 * 没有配方时逐字退回静态定义。
 *
 * 2026-11-23 再收窄：default 的**值**是配方业务数据（字段数组 / 免责长文案等），
 * 由宿主 WorkflowRunner.resolveInputs 在模型省略该键时自行补齐（见该函数的注释与
 * 「模型给了就用模型值；没给且有 default 用 default」实现）。模型只需知道「有缺省、
 * 可省略」，不需要也不该在工具说明里读到值本身 —— 省 token，且与「业务数据不进
 * 模型上下文」一致。required / type / enum 仍逐字保留：它们是填参约束，不是缺省值。
 */
function describeInputs(decls: readonly WorkflowInput[] | undefined): string {
  if (!decls || decls.length === 0) return '（该技能无需填空参数）';
  return decls.map((d) => {
    const bits = [`${d.name}: ${d.type}`];
    if (d.required === true) bits.push('必填');
    // 只标「有缺省、可省略」，不复述 default 的值；值由宿主 runner 补齐。
    if (d.default !== undefined) bits.push('可省略(有缺省)');
    if (d.enum !== undefined) {
      try { bits.push(`枚举 ${JSON.stringify(d.enum)}`); } catch { /* 不可序列化的 enum 略过 */ }
    }
    return bits.join('，');
  }).join('；');
}

function buildWorkflowTool(active: readonly SkillRecipe[]): ModelToolDefinition {
  const wfSkills = active.filter((s) => s.workflow !== undefined);
  const lines = wfSkills
    .map((s) => `- ${s.id}（${s.name}）：${describeInputs(s.inputs)}`);
  const skillIdProperty: Record<string, unknown> = {
    type: 'string',
    description: '带 workflow 声明的技能 id',
  };
  if (wfSkills.length > 0) skillIdProperty['enum'] = wfSkills.map((s) => s.id);
  return {
    ...RUN_WORKFLOW_TOOL,
    description: `${RUN_WORKFLOW_TOOL.description}\n\n本轮可用的工作流技能与 inputs 契约：\n${lines.join('\n')}`,
    parameters: {
      ...RUN_WORKFLOW_TOOL.parameters,
      properties: {
        ...(RUN_WORKFLOW_TOOL.parameters as { properties?: Record<string, unknown> }).properties,
        skillId: skillIdProperty,
      },
    },
  };
}

/**
 * 成功观察只回「完成 + 句柄」，绝不把任何业务 value 回灌模型上下文。
 * 句柄 = skillId（哪次任务）+ 结果落在哪条宿主旁路（展示块 / 动作链接 / 仅宿主内部）。
 * 结果内容本身走 effects 旁路、由 ChatUseCase 直接交给渲染层并落历史，
 * 与 ToolOutcome.displayMarkdown / actionLink 同口径，不进 role:'tool'。
 */
function successObservation(result: WorkflowRunResult, skillId: string): string {
  const hasMarkdown = result.effects.some(
    (e) => typeof e.displayMarkdown === 'string' && e.displayMarkdown.length > 0,
  );
  const hasLink = result.effects.some(
    (e) => typeof e.actionLink === 'string' && e.actionLink.length > 0,
  );
  const handles: string[] = [];
  if (hasMarkdown) handles.push('宿主展示块');
  if (hasLink) handles.push('宿主动作链接');
  const place = handles.length > 0 ? handles.join(' + ') : '宿主内部（无可见旁路产物）';
  return `workflow「${skillId}」执行完成：已完成 ${result.completedStepIds.length} 个节点。\n`
    + `结果位置（句柄）：${place}；结果内容由宿主旁路交付，未进入本轮模型上下文。\n`
    + '请如实告知用户任务已完成、结果见宿主呈现；不要复述、归纳、翻译或补写结果内容，也不要编造未取到的数据。';
}

/** 结构化失败文本：哪个节点 / 什么错 / 已完成节点列表，供模型兜底表达。 */
function failureObservation(result: WorkflowRunResult): string {
  const f = result.failure;
  if (!f) return 'workflow 执行失败（无结构化错误信息），请如实说明未完成，不要编造。';
  const done = f.completedStepIds.length > 0 ? f.completedStepIds.join('、') : '（无）';
  // 未注册算子（常见于插件算子未安装）：给模型一条可执行的兜底话术，
  // 让它如实告诉用户「需装某某算子」，而不是含糊其辞。error 字段本身
  // 仍逐字是「未注册算子:<name>」，结构化信息不被文案污染。
  const installHint = f.error.startsWith('未注册算子:')
    ? `\n- 提示：算子「${f.error.slice('未注册算子:'.length)}」尚未在本机启用/安装，请如实告诉用户需先安装对应算子插件，不要伪造结果。`
    : '';
  return `workflow 执行失败：\n`
    + `- 出错节点：${f.stepId}\n`
    + `- 错误：${f.error}\n`
    + `- 已完成节点：${done}\n`
    + installHint
    + '宿主已短路、不会自动重试。请据以上事实如实告诉用户，或在新一轮换参数重跑；不要编造未取到的数据。';
}

/**
 * 方案②：把 runner 累积的 effects 合并成现有单值出口。
 * - displayMarkdown：所有非空段按节点顺序用 '\n\n' 拼接（不丢数据）；
 * - actionLink：最后一个非空 url；label 来自 inputs.label > skill.name > 固定兜底。
 */
function mergeEffects(
  result: WorkflowRunResult,
  inputs: Record<string, unknown>,
  skill: SkillRecipe,
): Pick<ToolOutcome, 'displayMarkdown' | 'actionLink'> {
  const out: Pick<ToolOutcome, 'displayMarkdown' | 'actionLink'> = {};
  const markdowns = result.effects
    .map((e) => e.displayMarkdown)
    .filter((m): m is string => typeof m === 'string' && m.length > 0);
  if (markdowns.length > 0) out.displayMarkdown = markdowns.join('\n\n');

  let lastUrl: string | undefined;
  for (const e of result.effects) {
    if (typeof e.actionLink === 'string' && e.actionLink.length > 0) lastUrl = e.actionLink;
  }
  if (lastUrl !== undefined) {
    // label 来源：模型 inputs.label（若给了字符串）> 配方展示名 > 固定兜底。
    // 不凭空编造业务 label；StepResult.effects[].actionLink 只有 url（OperatorRegistry 丢了 label）。
    const fromInputs = inputs['label'];
    const label = typeof fromInputs === 'string' && fromInputs.trim().length > 0
      ? fromInputs.trim()
      : (skill.name.trim() || '打开链接');
    out.actionLink = { url: lastUrl, label };
  }
  return out;
}

/** 从 active 里查带 workflow 的 skill（按 id 精确匹配，信任路由/选取结果）。 */
function findWorkflowSkill(
  active: readonly SkillRecipe[], skillId: string,
): SkillRecipe | undefined {
  return active.find((s) => s.id === skillId && s.workflow !== undefined);
}

/**
 * 构造 run_workflow 的 tools/executors。
 * `active` 里没有任何带 workflow 的配方时返回空集（不挂工具 → 零额外 token）。
 */
export function buildWorkflowToolParts(
  active: readonly SkillRecipe[],
  registry: OperatorRegistry,
  onTrace?: (s: PluginTraceStep) => void,
): WorkflowToolParts {
  if (!active.some((s) => s.workflow !== undefined)) {
    return { tools: [], executors: {} };
  }

  const executors: Record<string, ToolExecutor> = {};
  executors[RUN_WORKFLOW_TOOL_NAME] = async (argsJson: string): Promise<ToolOutcome> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsJson) as unknown;
    } catch {
      return {
        observation: 'run_workflow 参数不是合法 JSON，请给出 {skillId, inputs}。',
        ok: false,
        detail: '参数解析失败',
      };
    }
    const req = (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed as Record<string, unknown>
      : {};
    const skillId = typeof req['skillId'] === 'string' ? req['skillId'] : '';
    const rawInputs = req['inputs'];
    const inputs: Record<string, unknown> =
      (rawInputs !== null && typeof rawInputs === 'object' && !Array.isArray(rawInputs))
        ? rawInputs as Record<string, unknown>
        : {};
    const skill = findWorkflowSkill(active, skillId);
    if (!skill || !skill.workflow) {
      return {
        observation: `run_workflow：未找到带 workflow 声明的技能「${skillId}」。`
          + `本轮可用工作流技能：${active.filter((s) => s.workflow !== undefined).map((s) => s.id).join('、') || '（无）'}。`,
        ok: false,
        detail: `未知工作流技能 ${skillId}`,
      };
    }

    const result = await runWorkflow(
      skill.workflow, inputs, registry, onTrace, skill.inputs,
    );
    const outcome: ToolOutcome = {
      observation: result.ok ? successObservation(result, skillId) : failureObservation(result),
      ok: result.ok,
      detail: result.ok
        ? `workflow ${skill.id} 完成 ${result.completedStepIds.length} 步`
        : `workflow ${skill.id} 失败于 ${result.failure?.stepId ?? '<unknown>'}`,
      ...mergeEffects(result, inputs, skill),
    };
    // preparatory / repairable 刻意不置位：workflow 是实质动作，占一次决策。
    return outcome;
  };

  return { tools: [buildWorkflowTool(active)], executors };
}
