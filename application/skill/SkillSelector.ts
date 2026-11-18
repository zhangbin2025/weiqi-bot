/**
 * 技能选择器：按路由给出的技能 id 做激活前硬门槛筛选。
 * @module application/skill/SkillSelector
 *
 * 旧的「包含即命中」触发词匹配已删除：词表要人肉枚举、零词汇重叠的自然说法
 * 永远命中不了。现在由 SkillRouter 让 LLM 理解意图后给出 id，本模块只负责
 * **不信任模型输出**的那部分（纯函数、零阈值）：
 * - 只认路由给出的 id，保持 recipes 原始顺序，不排序、不打分；
 * - 只用 primitives 全部存在于宿主注册表的技能，缺原语整条跳过；
 * - 声明了 requiredCapabilities 的技能，要求当前已启用能力库暴露的方法名
 *   并集包含每一项；缺一项整条跳过；
 * - 附件场景：hasAttachments 且技能 id 以 'event.import' 开头时，即使路由
 *   没给该 id 也保留 —— 上传图片时文字常只是「这个」「帮我看看」，
 *   「预览 → 用户确认」那一轮的「好的/确认」也不含明确意图。上下文里仍带
 *   图片附件即持续可用，直到图片滑出既有 maxMessages=20 历史窗口。
 *   这是环境事实（宿主知道有附件），不是对模型意图的猜测。
 * - 路由返回空 / 失败 → 无命中（本轮只挂基础 web 工具，零额外 token）。
 */

import type { SkillPrimitive, SkillRecipe } from '@application/skill/SkillTypes';

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
 * skillIds 由 SkillRouter 给出；未给出（空集）时只保留附件场景技能。
 */
export function selectSkills(
  skillIds: readonly string[],
  hasAttachments: boolean,
  recipes: readonly SkillRecipe[],
  registry: ReadonlyMap<string, SkillPrimitive>,
  /** 当前已启用 llm-tool 能力库暴露的方法名；不传 = 无能力库 */
  capabilities: ReadonlySet<string> | readonly string[] = [],
): SkillRecipe[] {
  const wanted = new Set(skillIds);
  const result: SkillRecipe[] = [];
  for (const skill of recipes) {
    if (!hasAllPrimitives(skill, registry)) continue;
    if (!hasAllCapabilities(skill, capabilities)) continue;
    if (wanted.has(skill.id) || matchesAttachmentEvent(skill.id, hasAttachments)) {
      result.push(skill);
    }
  }
  return result;
}
