/**
 * 阶段二 `run_workflow` 工具：把带 `workflow` 声明的配方挂进 ToolLoop。
 * @module application/skill/WorkflowTool
 *
 * 触发形态（契约「触发接线」/ 条款 10）：路由命中 → 模型 `run_workflow({skillId, inputs})`
 * 填 inputs → 宿主跑完 DAG → 结果走 effects 旁路直接交付用户 → 模型只收「完成 + 句柄」。
 * 业务数据不进模型上下文（successObservation 不序列化任何 value）；确定性步骤 0 次模型调用。
 *
 * 2026-11-25 B2：`returnToLLM:true` 配方（如弈友圈圈层分析）需要模型据数据做关系分析。
 * 实测 yield 汇总 debugValue 达 85,323 字符（单块上限 8000 的 10.7 倍），旧实现单块回灌
 * 被 clipForReturnToLLM 裁到 8000、再被 ToolLoop.clipObservation 二次裁剪，连
 * 「请据以上数据分析 / 不要编造」都被切掉。现改为：run_workflow 把全文写进宿主侧
 * 进程内结果缓存，观察只回「完成 + 总字符数 + resultId + 指路」；模型用专用只读工具
 * `workflow_result_read` 分块读全后再分析。读取器薄转发既有 executeWebCacheRead 引擎
 * （resultId→url），零重复分页逻辑；preparatory:true 让分页读取不占自主决策轮数。
 *
 * 例外：`run_workflow({debug:true})` 是「开发」角色验收/调试技能的显式开关——
 * 宿主把每步入参/输出/失败点 + 最终交付结果结构化回灌模型，供定位哪一步算错；
 * 不传 / false 逐字沿用上面的「完成 + 句柄」，chat 角色工具定义也不暴露该参数。
 *
 * 与散文路径**并列**（B 决策）：`buildSkillToolParts` 原样保留，本文件只是在
 * 同一 `ToolKit` 追加一个新工具；两类配方走同一个 ToolLoop、同一批基础能力，
 * 但不共享执行语义。没有 workflow 配方的轮次不挂（零额外 token）。
 *
 * 2026-11-25 修复「skill_write 修订不反映到 run_workflow」：executor 不再吃
 * 装配期 `active` 快照，dev 角色每次调用经 `devHooks.listCandidates()` 重新读本地库
 * （含未验收停用的候选，否则刚写的配方连调试都跑不了）。只有 `debug:true`
 * 且 DAG 全绿时由 `devHooks.accept()` 翻转启用——调试通过才启用。
 * chat 角色沿用装配期快照（chat 无同轮写技能能力，零回归）。
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
import { CONTEXT_LIMITS } from '@application/chat/ConversationPrompt';
import {
  createMemoryWebFetchCache, executeWebCacheRead,
} from '@application/chat/WebFetchCache';
import { runWorkflow, type WorkflowRunResult, type WorkflowStepTrace } from './WorkflowRunner';

/** 形状对齐 SkillRegistry.ChatToolKitParts（同一 ToolKit 拼装口径）。 */
export interface WorkflowToolParts {
  tools: ModelToolDefinition[];
  executors: Record<string, ToolExecutor>;
}

export const RUN_WORKFLOW_TOOL_NAME = 'run_workflow';

/**
 * 专用只读工具：读回 run_workflow（returnToLLM:true 配方）落在宿主结果缓存里的
 * yield 汇总全文。B2 方案：不动 web_cache_read 的 URL 语义，另开一份进程内缓存 +
 * 薄转发读取器，让 LLM 分块读全后再做关系分析。
 */
export const WORKFLOW_RESULT_READ_TOOL_NAME = 'workflow_result_read';

export const WORKFLOW_RESULT_READ_TOOL: ModelToolDefinition = {
  name: WORKFLOW_RESULT_READ_TOOL_NAME,
  description:
    `${WORKFLOW_RESULT_READ_TOOL_NAME}：`
    + '读取 run_workflow（returnToLLM:true 配方）存入宿主结果缓存的 yield 汇总全文。'
    + 'run_workflow 成功观察里给的是结果句柄（resultId），不是数据本体；'
    + '必须用本工具把全文分段读全之后再做关系分析，不要凭第一段猜测或补写未读部分。'
    + 'resultId 填观察里给的那个值（即刚跑的 skillId）。三种 mode：'
    + 'info 看总字符数/行数；slice 按字符区间分页（不给 length 时自动按单条上限推导）；'
    + 'grep 逐行正则查找。主推 slice：{\"resultId\":\"...\",\"mode\":\"slice\",\"offset\":0}，'
    + '按每次返回的「请把 offset 设为 X 继续读」提示递增 offset，直到「已到正文末尾」。'
    + '每次返回都控制在单条观察上限内，读不完就按提示继续翻页。'
    + '本工具是只读准备动作，不消耗自主决策轮数；'
    + '没读完全文前不要下结论，也不要只据第一片归纳。'
    + '返回里的 URL 字样即读取键（resultId），由复用引擎带出，不是网络地址。',
  parameters: {
    type: 'object',
    properties: {
      resultId: {
        type: 'string',
        description: 'run_workflow 观察里给出的 resultId（即刚跑的 skillId）；缓存按此键索引',
      },
      mode: {
        type: 'string',
        enum: ['info', 'slice', 'grep'],
        description: 'info=元信息 / slice=字符区间分页 / grep=逐行正则查找',
      },
      offset: {
        type: 'integer', minimum: 0,
        description: 'slice 的起始字符偏移（0 起，与 String.slice 同口径）；不传为 0',
      },
      length: {
        type: 'integer', minimum: 1,
        description: 'slice 要读多少字符；不传则由单条观察上限减去头部/尾部开销推导',
      },
      pattern: {
        type: 'string',
        description: 'grep 的正则字符串；语法受当前 JS 引擎 RegExp 限制',
      },
      flags: {
        type: 'string',
        description: 'grep 的正则标志，只允许 i/m/s/u；不允许 g/y',
      },
      before: {
        type: 'integer', minimum: 0,
        description: 'grep 命中行之前带几行上下文；不传为 0',
      },
      after: {
        type: 'integer', minimum: 0,
        description: 'grep 命中行之后带几行上下文；不传为 0',
      },
      skip: {
        type: 'integer', minimum: 0,
        description: 'grep 跳过前 N 条命中，用于翻页；不传为 0',
      },
      limit: {
        type: 'integer', minimum: 1,
        description: 'grep 最多回多少条命中；不传则按输出字符上限能装多少回多少',
      },
      count: {
        type: 'boolean',
        description: 'grep 为 true 时只回命中行数，不回行内容',
      },
    },
    required: ['resultId', 'mode'],
    additionalProperties: false,
  },
};

/** 静态兜底定义（无 active workflow 配方时不会挂；保留导出供测试/静态引用）。 */
export const RUN_WORKFLOW_TOOL: ModelToolDefinition = {
  name: RUN_WORKFLOW_TOOL_NAME,
  description:
    '按技能的 workflow 声明由宿主一次跑完确定性 DAG（取数 / 提取 / 渲染等确定性步骤），'
    + '调用前先在本轮可用技能里找带 workflow 的 skillId，并按该技能 inputs 契约填 inputs。'
    + '宿主按声明顺序执行：结果由宿主旁路（展示块 / 动作链接）直接交付用户，'
    + '正常调用你只会收到「完成 + 结果位置（句柄）」，不会拿到结果内容；'
    + '失败即短路并把「哪个节点 / 什么错 / 已完成节点」结构化回灌；'
    + '不要自己逐步调用底层工具，也不要复述、归纳或凭空补写结果内容。'
    + '（例外：「开发」角色验收 / 排查时传 debug:true，宿主会改为回灌逐步数据与最终结果，见下方调试说明。）',
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
 * 路由目录（SkillRouter）给可选路由词、这里给填参契约，两者合起来就是模型在
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

export interface WorkflowDevCandidate {
  recipe: SkillRecipe;
  /** 本地库启停状态；workflow 配方保存/修订后为 false，debug 跑通才转 true */
  enabled: boolean;
}

/** 开发角色宿主内部接线（不暴露给模型）：动态候选 + 验收闸门 */
export interface WorkflowDevHooks {
  /** 每次 run_workflow 调用重新读本地库；含未启用候选，供 dev 调试 */
  listCandidates(): Promise<readonly WorkflowDevCandidate[]>;
  /** debug:true 且 DAG 全绿后由宿主翻转该技能为已验收启用 */
  accept(skillId: string): Promise<void>;
}

function buildWorkflowTool(
  active: readonly SkillRecipe[], devMode: boolean,
): ModelToolDefinition {
  const wfSkills = active.filter((s) => s.workflow !== undefined);
  // dev 模式下 active 是装配期快照，只用于「当前有哪些技能」的**提示性**清单：
  // 同轮 skill_write 出来的新技能/新版本不在其中，故 dev 不写死 skillId enum，
  // 改由下面的 description 指路 skill_list（实时读库）。chat 沿用静态 enum。
  const lines = wfSkills.length > 0
    ? wfSkills.map((s) => `- ${s.id}（${s.name}）：${describeInputs(s.inputs)}`)
    : ['- （装配时还没有带 workflow 声明的技能；若刚写的是散文配方，见下）'];
  const skillIdProperty: Record<string, unknown> = {
    type: 'string',
    description: devMode
      ? '本地技能 id（带 workflow 声明的可跑 DAG；散文配方会收到明确提示）。'
        + '本轮可能刚用 skill_write 写过/改过技能，清单会变：调用 skill_list 拿最新 id 原样填入，'
        + '不要照抄上面装配时列出的旧 id，也不要凭空编造。'
      : '带 workflow 声明的技能 id（见本轮可用技能）',
  };
  if (!devMode && active.length > 0) skillIdProperty['enum'] = active.map((s) => s.id);
  const baseProps = (RUN_WORKFLOW_TOOL.parameters as { properties?: Record<string, unknown> }).properties ?? {};
  // 静态定义是 chat 口径（无 debug）；只有「开发」角色在这里显式加进 parameters，
  // 模型才知道可以开启调试。chat 侧 properties 与改动前逐字一致（零额外 token）。
  const properties: Record<string, unknown> = { ...baseProps, skillId: skillIdProperty };
  if (devMode) {
    properties['debug'] = {
      type: 'boolean',
      description: '调试开关：验收 / 排查技能时**就传 true**（这正是该传的场景，不是「正常调用」）。'
        + '宿主会把每一步的入参、输出 value、失败点和最终交付结果回灌给你，'
        + '用来逐条核对关键词文本、条数、结果对不对。'
        + '即便刚才不带 debug 的调用已经成功，也可以用同一 skillId 立即再调一次带 debug:true 复跑对照。'
        + '只给最终用户交付、不需要核对内容时才不传。',
    };
  }
  // 静态 description 里的「只会收到完成+句柄、不要复述结果」是**正常模式**契约；
  // devMode 必须显式覆盖，否则模型即便拿到调试数据也会以为自己不该分析。
  const debugHint = devMode
    ? '\n\n【调试开关（仅开发角色）】验收/排查带 workflow 的技能时传 debug:true：'
      + '此时上面「只会收到完成+句柄、不要复述结果」的约束不适用——宿主会把每一步的实际入参、'
      + '输出 value、失败点，以及最终交付给用户的展示块/动作链接/yield 汇总一起回灌给你，'
      + '你要据此分析哪一步输出不对、最终结果是否正确，再按同一 id 用 skill_write 修订配方复跑对照。'
      + '刚跑完一次不带 debug 的普通调用也没关系——立刻用同一 skillId 再调一次带 debug:true 即可拿到逐步数据，'
      + '不要因为上一轮只回了「完成+句柄」就回复用户「没法核对」。'
      + '调试观察只在本轮、不落会话历史。正常调用（不传 debug）仍严格只收「完成+句柄」。'
    : '';
  // A5：静态常量里「正常调用你只会收到完成+句柄、不要归纳结果内容」只对默认配方准确；
  // 有 returnToLLM:true 配方时条件追加一段，说明结果句柄 + workflow_result_read 读全路径，
  // 且这类配方不受「不要复述/归纳结果内容」约束。无此类配方逐字不加（chat 零额外 token）。
  const hasReturnToLLM = wfSkills.some((s) => s.returnToLLM === true);
  const returnToLLMHint = hasReturnToLLM
    ? '\n\n【结果句柄配方（returnToLLM:true）】这些配方的 run_workflow 成功观察返回的是'
      + '结果句柄（resultId），不是数据本体：按观察里的 resultId 用 '
      + `${WORKFLOW_RESULT_READ_TOOL_NAME} 分段把 yield 汇总读全之后，再据数据做关系分析；`
      + '这类配方不受上面「不要复述/归纳结果内容」的约束，但读全前不要下结论、不要编造。'
    : '';
  return {
    ...RUN_WORKFLOW_TOOL,
    description: `${RUN_WORKFLOW_TOOL.description}\n\n${devMode ? '装配时的工作流技能' : '本轮可用的工作流技能'}与 inputs 契约：\n${lines.join('\n')}${debugHint}`
      + (devMode ? '\n（该清单是装配时刻快照；刚保存/修订的配方请用 skill_list 查最新 id 再调用。）' : '')
      + returnToLLMHint,
    parameters: { ...RUN_WORKFLOW_TOOL.parameters, properties },
  };
}

/**
 * 成功观察分两种：
 * - !returnToLLM（缺省 / false）：只回「完成 + 句柄」，绝不把任何业务 value 回灌模型上下文。
 *   句柄 = skillId（哪次任务）+ 结果落在哪条宿主旁路（展示块 / 动作链接 / 仅宿主内部）。
 *   结果内容本身走 effects 旁路、由 ChatUseCase 直接交给渲染层并落历史，
 *   与 ToolOutcome.displayMarkdown / actionLink 同口径，不进 role:'tool'。
 * - returnToLLM:true（B2）：yield 汇总全文由 run_workflow 写进宿主结果缓存，
 *   观察只回「完成 + 总字符数 + resultId + 指路」，模型用 workflow_result_read 分块读全后再分析。
 *   观察本身不含任何数据本体，且整条不超过单条上限，消除 ToolLoop.clipObservation 二次裁剪。
 */
function successObservation(
  result: WorkflowRunResult, skillId: string, devMode = false,
  returnToLLM = false,
): string {
  // 两分支共用的第一行：只报告「完成 + 节点数」，不含任何交付口径措辞。
  const firstLine = `workflow「${skillId}」执行完成：已完成 ${result.completedStepIds.length} 个节点。\n`;
  // chat / 不传 devMode：逐字沿用旧第三句（既有测试断言与零回归契约）。
  // dev 的正常模式：模型正处在「验收 / 排查」语境，旧第三句「请如实告知用户任务
  // 已完成」会让它直接结束本轮、回复「没法逐条核对」；改成指路，告诉它同一
  // skillId 再调一次带 debug:true 就能拿到逐步数据，不要就此下结论。
  const defaultTail = devMode
    ? '如果你是来验收 / 排查这个技能的，不要就此下结论说「没法核对」：'
      + `用同一 skillId「${skillId}」再调用一次 run_workflow 并带 debug:true，`
      + '宿主会把每一步输出和最终交付结果回灌给你，供你逐条核对；'
      + '不要复述、归纳或凭空补写本轮没拿到的结果内容。'
    : '请如实告知用户任务已完成、结果见宿主呈现；不要复述、归纳、翻译或补写结果内容，也不要编造未取到的数据。';
  if (!returnToLLM) {
    // 默认 false / 缺省：完整返回字符串与改动前逐字一致（既有断言零回归）。
    // 句柄信息只在本分支需要：结果确实走宿主旁路、不进模型上下文。
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
    const head = firstLine
      + `结果位置（句柄）：${place}；结果内容由宿主旁路交付，未进入本轮模型上下文。\n`;
    return head + defaultTail;
  }

  // returnToLLM===true（B2）：yield 汇总全文由 executor 写进宿主结果缓存，
  // 观察只回「完成 + 事实元信息（总字符数）+ 结果句柄 + 读取指路 + 读全后分析」。
  // 不含任何数据本体（【yield 汇总 values】正文 / value 字段），整条控制在单条上限内，
  // 避免 ToolLoop.clipObservation 把「不要编造」「读全后再分析」等指令截掉（双重裁剪缺陷）。
  // 总字符数是事实、不是阈值；体积口径沿用既有 CONTEXT_LIMITS.maxCharsPerMessage。
  const valuesText = `【yield 汇总 values】\n${debugValue(result.values)}`;
  const readTail = `yield 汇总全文共 ${valuesText.length} 字符，已存入宿主结果缓存。\n`
    + `结果句柄 resultId：${skillId}；数据本体不在这条观察里，请用 ${WORKFLOW_RESULT_READ_TOOL_NAME} 分段读全。\n`
    + `先调 {\"resultId\":\"${skillId}\",\"mode\":\"info\"} 看总量；`
    + `主推 {\"resultId\":\"${skillId}\",\"mode\":\"slice\",\"offset\":0}，即 mode:\"slice\" 从 offset:0 起读，`
    + '按每次返回的「请把 offset 设为 X 继续读」递增 offset，直到「已到正文末尾」。\n'
    + '读全后再做关系分析，逐条给出基于数据的理由；读全后再分析前不要下结论、不要只据第一片归纳；'
    + '不要复述或翻译原始 JSON、不要把数据原样重列一遍；'
    + '任一节点失败或数据缺失时如实说明，不要编造。';
  const observation = firstLine + readTail;
  // 保险：skillId 极长时整条观察仍不越上限（沿用既有上限、不新增数值常量）；
  // 正常 skillId 下这条永远不触发，保留的是「不被二次裁剪」的不变式。
  return observation.length <= CONTEXT_LIMITS.maxCharsPerMessage
    ? observation
    : observation.slice(0, CONTEXT_LIMITS.maxCharsPerMessage - 1) + '…';
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

/** 从 active 里按 id 精确查技能（信任路由/选取结果）。
 * dev 模式下 active 含散文配方：这里不再过滤 workflow，
 * 由 executor 区分「找不到 id」与「找到了但没有 DAG 声明」。 */
function findWorkflowSkill(
  active: readonly SkillRecipe[], skillId: string,
): SkillRecipe | undefined {
  return active.find((s) => s.id === skillId);
}

/**
 * 构造 run_workflow 的 tools/executors。
 * chat（devMode=false）：`active` 里没有任何带 workflow 的配方时返回空集
 * （不挂工具 → 零额外 token），逐字沿用既有契约。
 * dev：恒定挂 run_workflow —— 开发说明已承诺「验收时调 run_workflow + debug:true」，
 * 若模型把流程误写成散文配方，工具也必须出现，好让它拿到结构化回执去修配方，
 * 而不是工具整个消失、只能回一句「工具清单里没有 run_workflow」。
 */
export function buildWorkflowToolParts(
  active: readonly SkillRecipe[],
  registry: OperatorRegistry,
  onTrace?: (s: PluginTraceStep) => void,
  devMode = false,
  /** dev 宿主内部接线；不传则沿用装配期 active（chat / 精简测试） */
  devHooks?: WorkflowDevHooks,
): WorkflowToolParts {
  const wfCount = active.filter((s) => s.workflow !== undefined).length;
  console.info('[wf-diag] buildWorkflowToolParts()', {
    devMode, active: active.length, withWorkflow: wfCount,
    activeIds: active.map((s) => s.id),
    dynamicLookup: devHooks !== undefined,
    earlyReturn: !devMode && wfCount === 0,
  });
  if (!devMode && !active.some((s) => s.workflow !== undefined)) {
    return { tools: [], executors: {} };
  }

  // A2：一次 buildChatToolKit = 一次 tool loop = 一轮对话。进程内 Map 缓存，
  // run_workflow 写入 → 同轮紧随的 N 次 workflow_result_read 读出，天然对齐；
  // 重新装配即新缓存，跨测试零污染。不用 defaultWebFetchCache（那是 web_fetch 的
  // URL 命名空间，塞 workflow 键会污染其语义，正是选 B2 而非 B1 的原因）。
  const wfResultCache = createMemoryWebFetchCache();
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
    const debug = req['debug'] === true;
    const rawInputs = req['inputs'];
    const inputs: Record<string, unknown> =
      (rawInputs !== null && typeof rawInputs === 'object' && !Array.isArray(rawInputs))
        ? rawInputs as Record<string, unknown>
        : {};
    // dev：每次调用重新读库（skill_write 修订当场生效，不再吃装配期快照）。
    // 候选含未验收停用的条目，否则刚写的 workflow 配方连 debug 都跑不了。
    // 读失败如实回执，不静默回落到旧快照——旧快照正是本次 bug 的来源。
    let effActive: readonly SkillRecipe[] = active;
    let candidates: readonly WorkflowDevCandidate[] = [];
    if (devHooks !== undefined) {
      try {
        candidates = await devHooks.listCandidates();
        effActive = candidates.map((c) => c.recipe);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          observation: `run_workflow：读取当前技能库失败（${reason}），未执行任何节点。`,
          ok: false, detail: `技能库读取失败 ${skillId}`,
        };
      }
    }
    const picked = candidates.find((c) => c.recipe.id === skillId);
    console.info('[wf-diag] run_workflow() executor', {
      skillId, debug, dynamicLookup: devHooks !== undefined,
      activeIds: effActive.map((s) => s.id),
      activeVersions: effActive.map((s) => `${s.id}@v${s.version}`),
      enabledMap: candidates.map((c) => `${c.recipe.id}=${c.enabled}`),
      picked: picked === undefined ? null : {
        id: picked.recipe.id, version: picked.recipe.version, enabled: picked.enabled,
        steps: picked.recipe.workflow?.steps.map((st) => st.id) ?? [],
      },
      withWorkflow: effActive.filter((s) => s.workflow !== undefined).map((s) => s.id),
    });
    const skill = findWorkflowSkill(effActive, skillId);
    if (!skill) {
      return {
        observation: `run_workflow：未找到技能「${skillId}」。`
          + `当前技能库：${effActive.map((s) => s.id).join('、') || '（无）'}。`
          + (devMode ? ' 刚写过技能的话先用 skill_list 核对 id 原样填入。' : ''),
        ok: false,
        detail: `未知技能 ${skillId}`,
      };
    }
    if (!skill.workflow) {
      return {
        observation: `run_workflow：技能「${skillId}」是散文配方，没有 workflow 声明，因此没有 DAG 可跑。`
          + ' 如果你要的是「抓取 → 提取 → 整理 → 展示」这类固定多步流程，'
          + '请用 skill_write 按同一 id 给整份配方补上 workflow.steps（primitives 填 []），'
          + '再调用 run_workflow 并带 debug:true 验收；'
          + '只写在 summary / prompt 里的流程描述不会被执行，也不会出现在工作流清单里。'
          + `当前带 workflow 的技能：${effActive.filter((s) => s.workflow !== undefined).map((s) => s.id).join('、') || '（无）'}。`,
        ok: false,
        detail: `散文配方无 workflow ${skillId}`,
      };
    }

    const result = await runWorkflow(
      skill.workflow, inputs, registry, onTrace, skill.inputs, debug,
    );
    // A3：只有成功 + 正常模式 + returnToLLM:true 才写缓存；失败 / debug / false 都不写。
    // 键 = skillId（与观察里的 resultId 逐字一致）；同 id 再跑覆盖，与 web_fetch 同口径。
    if (result.ok && !debug && skill.returnToLLM === true) {
      const text = `【yield 汇总 values】\n${debugValue(result.values)}`;
      wfResultCache.put(skillId, {
        url: skillId, status: 200, statusText: 'workflow yield',
        contentType: 'application/json', text, ok: true,
      });
    }
    // 验收闸门：debug:true 且 DAG 全绿才把该技能置为已验收启用。
    // 失败不翻转、非调试调用不翻转；翻转失败如实追加一行观察，不谎报已启用。
    // 验收回执放观察**开头**：ToolLoop 会按单条消息上限裁剪尾部，
    // 拼在末尾会被逐步数据/交付块挤掉，模型就看不到「已启用」这个状态。
    let acceptanceNote = '';
    if (debug && result.ok && devHooks !== undefined) {
      try {
        await devHooks.accept(skillId);
        acceptanceNote = '【验收】本次 debug 全步成功，技能已启用（调试通过才启用）。\n';
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        acceptanceNote = `【验收】debug 已跑通，但宿主启用技能失败：${reason}；技能仍处于未启用状态。\n`;
      }
    }
    const merged = mergeEffects(result, inputs, skill);
    const outcome: ToolOutcome = {
      // debug:true 时把逐步 trace + 最终交付结果回灌；否则逐字沿用旧观察。
      observation: acceptanceNote + (debug
        ? debugObservation(result, skillId, merged, skill.workflow.steps.length)
        : (result.ok
          ? successObservation(result, skillId, devMode, skill.returnToLLM === true)
          : failureObservation(result))),
      ok: result.ok,
      detail: result.ok
        ? `workflow ${skill.id} 完成 ${result.completedStepIds.length} 步${debug ? '（调试）' : ''}`
        : `workflow ${skill.id} 失败于 ${result.failure?.stepId ?? '<unknown>'}${debug ? '（调试）' : ''}`,
      ...merged,
    };
    // preparatory / repairable 刻意不置位：workflow 是实质动作，占一次决策。
    return outcome;
  };

  // A6：薄转发层 —— 校验 resultId/mode，把 resultId 映射成 url 后直接复用
  // executeWebCacheRead（自带分页引擎 + preparatory:true，按单条上限收口）。
  // 空缓存给自定义友好提示，不透传 web_fetch 语义的「请先调用 web_fetch 取回它」。
  executors[WORKFLOW_RESULT_READ_TOOL_NAME] = async (argsJson: string): Promise<ToolOutcome> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsJson) as unknown;
    } catch {
      return {
        observation: `${WORKFLOW_RESULT_READ_TOOL_NAME} 参数不是合法 JSON 对象。`,
        ok: false, detail: '参数解析失败', preparatory: true,
      };
    }
    const req = (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed as Record<string, unknown>
      : {};
    const resultId = req['resultId'];
    const mode = req['mode'];
    if (typeof resultId !== 'string' || resultId.trim() === '') {
      return {
        observation: `${WORKFLOW_RESULT_READ_TOOL_NAME}：缺少 resultId（填 run_workflow 观察里给的那个值，即 skillId）。`,
        ok: false, detail: '缺少 resultId', preparatory: true,
      };
    }
    if (mode !== 'info' && mode !== 'slice' && mode !== 'grep') {
      return {
        observation: `${WORKFLOW_RESULT_READ_TOOL_NAME}：mode 必须是 info / slice / grep 之一。`,
        ok: false, detail: '非法 mode', preparatory: true,
      };
    }
    if (wfResultCache.get(resultId) === undefined) {
      return {
        observation: `技能「${resultId}」本轮还没有可读取的 yield 结果，请先调用 run_workflow 跑该技能（或核对 resultId）。`,
        ok: false, detail: `无缓存 ${resultId}`, preparatory: true,
      };
    }
    // 薄转发：resultId → url，其余同名参数原样透传，不重写分页引擎。
    const mapped: Record<string, unknown> = { url: resultId, mode };
    for (const key of ['offset', 'length', 'pattern', 'flags', 'before', 'after', 'skip', 'limit', 'count']) {
      if (req[key] !== undefined) mapped[key] = req[key];
    }
    const read = executeWebCacheRead(JSON.stringify(mapped), wfResultCache);
    // WebCacheReadResult 与 ToolOutcome 同形状（preparatory:true 必须保留），显式构造避免结构漂移。
    return {
      observation: read.observation, ok: read.ok, detail: read.detail, preparatory: true,
    };
  };

  const toolDef = buildWorkflowTool(active, devMode);
  console.info('[wf-diag] buildWorkflowToolParts() result', {
    tools: [toolDef.name, WORKFLOW_RESULT_READ_TOOL_NAME],
    skillIdEnum: ((toolDef.parameters as { properties?: Record<string, unknown> })
      .properties?.['skillId'] as { enum?: string[] } | undefined)?.enum ?? [],
    debugExposed: 'debug' in ((toolDef.parameters as
      { properties?: Record<string, unknown> }).properties ?? {}),
  });
  return {
    tools: [toolDef, WORKFLOW_RESULT_READ_TOOL],
    executors,
  };
}

/** 把任意值序列化成模型可读文本；循环引用 / BigInt 等不可序列化时如实标注，不抛。 */
function debugValue(v: unknown): string {
  if (v === undefined) return '（无 value / undefined）';
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return `（不可 JSON 序列化：${String(v)}）`;
  }
}

/**
 * 逐步文本裁剪：单块份额 = floor(CONTEXT_LIMITS.maxCharsPerMessage / (N+1))。
 * - 分子是项目既有「一次允许给模型的单条文本量」（出处：ConversationPrompt.ts
 *   2026-11-19 注释，由 maxTotalChars 原值统一而来，不是新经验常数）；
 * - 分母 N+1 = **静态声明步数** N（spec.steps.length，由调用方透传）+ 最终交付结果一块；
 *   用 trace.length 会在失败短路时虚增份额，与注释口径不符，故不用它。
 * - 不设步数上限 / 重试 / 超时：确定性部分不消耗决策预算，沿用既有 maxTurns。
 * clipObservation 会在 ToolLoop 里再按同一常量兜底一次；这里先按声明步数均分，
 * 避免某一步大输出把后几步全挤掉（lost in the middle）。
 */
function clipForDebug(text: string, declaredSteps: number): string {
  const per = Math.max(1, Math.floor(CONTEXT_LIMITS.maxCharsPerMessage / (declaredSteps + 1)));
  if (text.length <= per) return text;
  const tail = '…[本步超过调试份额，已截断]';
  return text.slice(0, Math.max(0, per - tail.length)) + tail;
}

/** 单步调试块：拼成一整块后按「整步份额」裁剪一次，避免 3 个字段各自裁剪、
 *  合起来撑爆总量让 ToolLoop 把后半程全截掉（与「均分防 lost in the middle」口径一致）。 */
function debugStepBlock(
  t: WorkflowStepTrace, index: number, total: number, declaredSteps: number,
): string {
  const lines = [`第 ${index + 1}/${total} 步 ${t.stepId}（${t.call}）：${t.ok ? '成功' : '失败'}`];
  lines.push(`  入参：${debugValue(t.args)}`);
  if (t.ok) {
    lines.push(`  输出 value：${debugValue(t.value)}`);
    if (t.effects.length > 0) {
      lines.push(`  本步 effects：${debugValue(t.effects)}`);
    }
  } else {
    lines.push(`  错误：${t.error ?? '（无错误文本）'}`);
  }
  return clipForDebug(lines.join('\n'), declaredSteps);
}

/**
 * 调试模式观察：把「每步发生了什么」+「最终交付给用户的结果」一起回灌。
 * - 逐步 trace 来自 runner 的 stepTrace（captureTrace:true 才有）；
 * - 最终交付 = mergeEffects 后的 displayMarkdown / actionLink（就是宿主旁路
 *   实际交付用户的那份），再加 yield 汇总 values；模型因此能判断结果对不对；
 * - 明确告诉模型这是调试信息、只用于定位与修订配方，不要当成给用户的答复。
 */
function debugObservation(
  result: WorkflowRunResult,
  skillId: string,
  merged: Pick<ToolOutcome, 'displayMarkdown' | 'actionLink'>,
  declaredSteps: number,
): string {
  const trace = result.stepTrace ?? [];
  const total = trace.length;
  const head = `workflow「${skillId}」调试模式（${result.ok ? '成功' : '失败'}，共记录 ${total} 步）。`
    + '以下是宿主实际执行的逐步数据与最终交付结果，只用于定位哪一步输出不对、'
    + '判断结果是否正确；不要把它们当成给用户的答复原文。\n';
  const stepsText = total > 0
    ? trace.map((t, i) => debugStepBlock(t, i, total, declaredSteps)).join('\n')
    : '（runner 未返回逐步记录）';
  const delivery: string[] = ['', '【最终交付给用户的结果（宿主旁路）】'];
  delivery.push(`- 展示块 displayMarkdown：${merged.displayMarkdown !== undefined && merged.displayMarkdown.length > 0
    ? merged.displayMarkdown : '（无）'}`);
  delivery.push(`- 动作链接 actionLink：${merged.actionLink !== undefined
    ? debugValue(merged.actionLink) : '（无）'}`);
  delivery.push(`- yield 汇总 values：${debugValue(result.values)}`);
  delivery.push(`- 已完成节点：${result.completedStepIds.join('、') || '（无）'}`);
  if (!result.ok && result.failure) {
    delivery.push(`- 失败：节点 ${result.failure.stepId} / ${result.failure.error}`);
  }
  delivery.push('', '定位到问题后，按同一 id 用 skill_write 给出完整配方修订；'
    + '下次验收仍可传 debug:true 复跑对照。');
  // 最终交付块也占一份份额（分母 N+1 里的那个 1），整块裁一次。
  // head 是定长说明，随整条 observation 一起由 ToolLoop.clipObservation 兜底。
  return head + stepsText + clipForDebug(delivery.join('\n'), declaredSteps);
}
