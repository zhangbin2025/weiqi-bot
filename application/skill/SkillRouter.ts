/**
 * 技能路由：由 LLM 理解用户意图，决定本轮激活哪些技能。
 * @module application/skill/SkillRouter
 *
 * 取代旧的「包含即命中」触发词匹配：触发词需要人肉枚举、零词汇重叠的自然说法
 * 永远命中不了。路由交给 LLM 按语义理解自然说法：目录给配方声明的「可选路由词」
 * （用户说什么话时选这条，拼成一行），不是让宿主去匹配词表、也不是宿主内置词。
 *
 * 边界：
 * - 只输出技能 id，不输出原语 / 参数 / 代码；未知 id 一律丢弃（防幻觉）。
 * - 路由失败（超时 / JSON 脏 / 端点异常）→ 空激活，正常对话继续，绝不打断用户。
 * - 目录只用 id / name / 可选路由词（routeHint，缺省只给 id|name），不塞完整
 *   summary / prompt（省每轮恒定 token、避免提示注入面扩大）。路由词只回答
 *   「要不要这条」；命中后的执行说明由 buildSkillSystemPrompt 注入散文 system、
 *   workflow 的填参契约由 run_workflow 工具定义给出（2026-11-23 二次收窄）。
 * - 调用走 IModelGateway 抽象层，options.jsonMode=true 由网关 wire 层落实；
 *   不直接碰 fetch / 凭据 / 端点配置。
 */

import type { IModelGateway, ModelMessage } from '../model/IModelGateway';
import type { SkillRecipe } from './SkillTypes';

/** 路由结果：本轮建议激活的技能 id（已过滤为目录内且去重） */
export interface SkillRouteResult {
  skillIds: string[];
  /** 失败时的一行人话，仅供 trace / 调试，不进模型上下文 */
  reason?: string;
}

export interface SkillRouteInput {
  /** 最近的用户消息文本（已按既有 maxMessages 窗口裁好，由调用方给） */
  recentUserTexts: readonly string[];
  /** 通用上下文信号：本轮上下文里是否仍带图片附件（不绑定任何具体技能） */
  hasAttachments: boolean;
  /** 上一轮激活的技能 id，供「好的 / 确认」这类承接语判断 */
  previousSkillIds?: readonly string[];
}

const ROUTER_SYSTEM =
  '你是技能路由器。根据用户消息与技能目录，判断本轮需要启用哪些技能。'
  + '依据技能的「名称与路由词（若目录提供）」判断要不要启用，不要猜测目录外的能力。'
  + '只输出严格 JSON：{"skillIds":["id",...]}。'
  + '规则：'
  + '1) skillIds 只能出现目录里列出的 id，绝不编造、绝不改写；'
  + '2) 不需要任何技能就输出 {"skillIds":[]}，不要为了「有用」硬选；'
  + '3) 用户消息只是承接上一轮（如「好的」「确认」「继续」「就这样」）且上下文信号里'
  + '   给了上一轮技能，就保留那些技能；'
  + '4) 上下文有图片附件时，结合用户消息与目录里每条技能提供的路由词判断是否需要启用技能；'
  + '5) 只输出 JSON 对象本身，不写解释、不写 markdown、不写代码块。';

/**
 * 目录文本：一条技能一行。
 * - 配了可选路由词（数组非空）：id | name | 路由词拼成的一行；多路由词用顿号
 *   join 成一行，保持「目录一技能一行」的形状，不引入新常量 / 截断启发式。
 * - 没配路由词：严格只给 `id | name` 两段（不回落 summary，用户决策）。
 * summary / prompt 都不进目录：散文执行说明由 buildSkillSystemPrompt 注入、
 * workflow 填参契约由 run_workflow 工具定义给出，省每轮恒定 token。
 */
function renderCatalog(recipes: readonly SkillRecipe[]): string {
  if (recipes.length === 0) return '（目录为空）';
  return recipes
    .map((s) => (s.routeHint !== undefined && s.routeHint.length > 0
      ? `- ${s.id} | ${s.name} | ${s.routeHint.join('、')}`
      : `- ${s.id} | ${s.name}`))
    .join('\n');
}

function renderContext(deps: SkillRouteInput): string {
  const lines: string[] = [];
  lines.push('【最近用户消息（按时间从旧到新）】');
  if (deps.recentUserTexts.length === 0) lines.push('（无）');
  else deps.recentUserTexts.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  lines.push('');
  lines.push('【上下文信号（宿主给出，不猜）】');
  lines.push(`有图片附件：${deps.hasAttachments ? '是' : '否'}`);
  const prev = deps.previousSkillIds ?? [];
  lines.push(`上一轮技能：${prev.length > 0 ? prev.join('、') : '无'}`);
  return lines.join('\n');
}

/**
 * 从模型返回里抠出 skillIds。容错但严格：
 * - 接受纯 JSON、或包了一层 markdown 代码块的 JSON（端点偶发）；
 * - 只收字符串、只收目录内 id、去重、保持模型给出顺序；
 * - 其它任何形状一律视为空，不抛给上层。
 */
export function parseRouteReply(text: string, knownIds: ReadonlySet<string>): string[] {
  let raw = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  if (fenced) raw = fenced[1]!.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const value = (parsed as Record<string, unknown>)['skillIds'];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'string' || !knownIds.has(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * 跑一次技能路由。任何失败都返回空 skillIds + reason，调用方据此
 * 「本轮不激活技能、正常对话继续」，不回落关键词、不重试、不打断。
 */
export async function routeSkills(
  gateway: IModelGateway,
  recipes: readonly SkillRecipe[],
  input: SkillRouteInput,
): Promise<SkillRouteResult> {
  if (recipes.length === 0) return { skillIds: [] };

  const knownIds = new Set(recipes.map((s) => s.id));
  const user = [
    '【技能目录】',
    renderCatalog(recipes),
    '',
    renderContext(input),
    '',
    '请输出本轮要启用的技能 id 列表（严格 JSON）。',
  ].join('\n');

  const messages: ModelMessage[] = [
    { role: 'system', content: ROUTER_SYSTEM },
    { role: 'user', content: user },
  ];

  try {
    const result = await gateway.execute({
      task: 'skill.route',
      messages,
      options: { jsonMode: true },
    });
    const skillIds = parseRouteReply(result.text, knownIds);
    return skillIds.length > 0
      ? { skillIds }
      : { skillIds: [], ...(result.text.trim() === '' ? { reason: '路由返回空内容' } : {}) };
  } catch (error) {
    return {
      skillIds: [],
      reason: `技能路由失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
