/**
 * 按本轮命中技能追加 system 指令。
 * @module application/skill/SkillSystemPrompt
 *
 * base 是 CONVERSATION_SYSTEM_PROMPT（本文件不修改它本身）。
 * active 为空时原样返回 base —— 零额外 token，闲聊完全不受影响。
 */

import type { SkillRecipe } from '@application/skill/SkillTypes';

/** 固定尾句：强调技能只是提示、写操作必须先预览并等确认 */
const SKILL_FOOTER =
  '技能只是提示，实际能力以本轮工具为准；写操作必须先给预览、结束本轮回复，等用户下一条消息明确确认后再提交。';

/** 每条技能的展示格式 */
function renderSkill(skill: SkillRecipe): string {
  return `- 名称：${skill.summary}\n  使用提示：${skill.prompt}`;
}

/**
 * 生成追加了技能说明的 system prompt。
 * 空 active → 返回 base 本身（不拼接、不追加空行）。
 */
export function buildSkillSystemPrompt(base: string, active: readonly SkillRecipe[]): string {
  if (active.length === 0) return base;
  const lines = ['本轮可用技能：', ...active.map(renderSkill), SKILL_FOOTER];
  return `${base}\n\n${lines.join('\n')}`;
}
