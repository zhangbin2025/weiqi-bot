/**
 * 技能选择器：按路由给出的技能 id 做激活前硬门槛筛选。
 * @module application/skill/SkillSelector
 *
 * 旧的「包含即命中」触发词匹配已删除：词表要人肉枚举、零词汇重叠的自然说法
 * 永远命中不了。现在由 SkillRouter 让 LLM 理解意图后给出 id，本模块只负责
 * **不信任模型输出**的那部分（纯函数、零阈值）：
 * - 只认路由给出的 id，保持 recipes 原始顺序，不排序、不打分；
 * - 只用 primitives 全部存在于宿主注册表的技能，缺原语整条跳过；
 * - 附件信号由 SkillRouter 用于路由上下文；本阶段只认路由 id，不因有附件
 *   额外放行任何技能（附件兜底后门已随对应业务功能删除）。
 * - 路由返回空 / 失败 → 无命中（本轮只挂基础 web 工具，零额外 token）。
 */

import type { SkillPrimitive, SkillRecipe } from '@application/skill/SkillTypes';

/**
 * 该技能引用的原语是否全部在宿主注册表里可用。
 *
 * 阶段二放宽：workflow 配方把能力声明为 workflow.steps[]（节点 call 算子名），
 * 不需要也不该再靠 primitives 非空来放行 —— 它已由 parseSkillRecipe 在安装期做过
 * 解析期静态校验（steps 非空、id 唯一、call 非空、bindings.from 指向更前 → 天然无环）。
 * 因此只要 skill.workflow 存在且 steps 非空，就视为「已过静态校验」直接放行。
 *
 * 「节点 call 是否命中已启用算子白名单」不在这里判：白名单是运行时 OperatorRegistry
 * 里已启用算子的集合，由 F 代理装配期（buildWorkflowToolParts 持有 registry）与
 * G 代理 assets 侧 validateWorkflowSkill 各自校验，未命中按 runner 的失败短路 +
 * 结构化回灌（需装某某算子）语义处理，不是本选择器的职责。
 *
 * 无 workflow（散文 prompt 配方）沿用原逻辑：primitives 必须非空且全部在 registry 里。
 * 本选择器不改 selectSkills 行为：保持 recipes 原始顺序、不排序不打分、只认 wanted id。
 */
function hasAllPrimitives(skill: SkillRecipe, registry: ReadonlyMap<string, SkillPrimitive>): boolean {
  if (skill.workflow !== undefined && skill.workflow.steps.length > 0) return true;
  return skill.primitives.length > 0 && skill.primitives.every((name) => registry.has(name));
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
): SkillRecipe[] {
  const wanted = new Set(skillIds);
  const result: SkillRecipe[] = [];
  for (const skill of recipes) {
    if (!hasAllPrimitives(skill, registry)) continue;
    if (wanted.has(skill.id)) {
      result.push(skill);
    }
  }
  return result;
}
