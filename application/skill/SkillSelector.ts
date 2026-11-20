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
 * - 附件信号由 SkillRouter 用于路由上下文；本阶段只认路由 id，不因有附件
 *   额外放行任何技能（附件兜底后门已随对应业务功能删除）。
 * - 路由返回空 / 失败 → 无命中（本轮只挂基础 web 工具，零额外 token）。
 */

import type { SkillPrimitive, SkillRecipe } from '@application/skill/SkillTypes';

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
 * skillIds 由 SkillRouter 给出；未给出（空集）时无命中。
 */
export function selectSkills(
  skillIds: readonly string[],
  /** 兼容调用方的位置参数；附件信号只用于路由上下文，选取阶段不据此放行 */
  _hasAttachments: boolean,
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
    if (wanted.has(skill.id)) {
      result.push(skill);
    }
  }
  return result;
}
