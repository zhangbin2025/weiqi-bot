/**
 * 技能选择器：按当前用户消息做「包含即命中」匹配。
 * @module application/skill/SkillSelector
 *
 * 规则（契约 §3，不做打分/阈值/模型二次检索）：
 * - 触发词命中：query 包含任一 trigger（大小写不敏感，中文直接 includes）；
 * - 附件场景：hasAttachments 且技能 id 以 'event.import' 开头即命中，
 *   **不再要求 query 含关键词** —— 用户上传图片时文字常只是「这个」「帮我看看」，
 *   「预览 → 用户确认」那一轮的「好的/确认」也不含触发词。上下文里仍带图片
 *   附件即持续命中，直到图片滑出既有 maxMessages=20 历史窗口（沿用既有常量）。
 * - 只用 primitives 全部存在于宿主注册表的技能，缺原语整条跳过；
 * - 声明了 requiredCapabilities 的技能，还要求当前已启用能力库暴露的方法名
 *   并集包含每一项；缺一项整条跳过（与缺原语同一层，激活前硬门槛）。
 * - 无命中 → 空数组（本轮只挂 3 个基础 web 工具，零额外 token）。
 */

import type { SkillPrimitive, SkillRecipe } from '@application/skill/SkillTypes';

/** 大小写不敏感（toLowerCase），中文因 toLowerCase 恒等仍是直接 includes */
function matchesTrigger(queryLower: string, triggers: readonly string[]): boolean {
  return triggers.some((t) => queryLower.includes(t.toLowerCase()));
}

function matchesAttachmentEvent(id: string, hasAttachments: boolean): boolean {
  return hasAttachments && id.startsWith('event.import');
}

/** 该技能引用的原语是否全部在宿主注册表里可用 */
function hasAllPrimitives(skill: SkillRecipe, registry: ReadonlyMap<string, SkillPrimitive>): boolean {
  return skill.primitives.length > 0 && skill.primitives.every((name) => registry.has(name));
}

/**
 * 该技能声明的 llm-tool 能力是否全部可用。
 * 未声明（字段缺省）→ 不检查，老配方逐字兼容；声明了空数组在 parseSkillRecipe
 * 阶段已被拒，这里不会遇到。capabilities 缺省（调用方没注入能力库）视为空集，
 * 因此有依赖的技能一律跳过 —— 宁可不激活，也不让模型拿到半套能力去编数据。
 */
export function hasAllCapabilities(
  skill: SkillRecipe,
  capabilities: ReadonlySet<string> | readonly string[] = [],
): boolean {
  const required = skill.requiredCapabilities;
  if (required === undefined || required.length === 0) return true;
  const available = capabilities instanceof Set
    ? capabilities
    : new Set(capabilities as readonly string[]);
  return required.every((name) => available.has(name));
}

/**
 * 选出本轮可用技能。保持 recipes 的原始顺序，不排序、不打分。
 */
export function selectSkills(
  query: string,
  hasAttachments: boolean,
  recipes: readonly SkillRecipe[],
  registry: ReadonlyMap<string, SkillPrimitive>,
  /** 当前已启用 llm-tool 能力库暴露的方法名；不传 = 无能力库 */
  capabilities: ReadonlySet<string> | readonly string[] = [],
): SkillRecipe[] {
  const queryLower = query.toLowerCase();
  const result: SkillRecipe[] = [];
  for (const skill of recipes) {
    if (!hasAllPrimitives(skill, registry)) continue;
    if (!hasAllCapabilities(skill, capabilities)) continue;
    if (matchesTrigger(queryLower, skill.triggers)
      || matchesAttachmentEvent(skill.id, hasAttachments)) {
      result.push(skill);
    }
  }
  return result;
}
