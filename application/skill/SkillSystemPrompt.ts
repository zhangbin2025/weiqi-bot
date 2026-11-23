/**
 * 按本轮命中的**散文技能**追加 system 指令。
 * @module application/skill/SkillSystemPrompt
 *
 * base 是 CONVERSATION_SYSTEM_PROMPT（本文件不修改它本身）。
 * active 为空时原样返回 base —— 零额外 token，闲聊完全不受影响。
 *
 * 2026-11-23 收窄（LLM 不再碰业务数据 / token 最小化）：
 * 带 `workflow` 的配方**不进这里**。它的可选路由词已在路由目录那一行
 * `- id | name | 可选路由词（若配方提供）`（SkillRouter.renderCatalog），填参契约已在
 * `run_workflow` 工具定义的 `skillId` enum + inputs 描述（WorkflowTool.buildWorkflowTool），
 * 结果走宿主旁路、成功观察只回「完成 + 句柄」——模型一轮只做一次决策，
 * 不需要整段 summary + prompt + SKILL_FOOTER 说明书。散文配方命中路径原样保留，
 * 不写兼容桥；本轮 active 全是 workflow 配方时逐字返回 base。
 */

import type { SkillRecipe } from '@application/skill/SkillTypes';

/**
 * 固定尾句：强调技能只是提示、写操作必须先预览并等确认。
 * 第二句是 navigate_to 既有契约的运行时兜底（2026-11-16 用户实测）：
 * 宿主把站内链接渲染成按钮，模型正文里不许出现自己编的外站网址。
 * 原文见 NavigateToPath.navigateToObservation；这里只是同一条规则在
 * 「工具被调用之前」也送达一次，不新增策略。空 active 时不拼接。
 *
 * 2026-11-19 收窄口径：这条禁的是「模型自己编的 http(s) 外站网址」，不是
 * 宿主原语返回的自定义 scheme markdown 链接。secret-prompt:<key>（凭据弹框）
 * 与 prefs-add:<domain>:<key>:<value>（通用偏好回灌）都由宿主事件委托接管，
 * 模型只负责把技能说明 / 观察里的链接**原样**贴出；不写清楚会被这句尾句挡住，模型要么不贴、
 * 要么自作主张改成普通网址。规则仍然是「不自造链接」，只是把「原样转贴
 * 宿主给的链接」显式列为允许。
 *
 * 同理，「写操作先预览等确认」约束的是会改动业务库 / 外部状态的两阶段提交
 * （预览 → 用户确认 → 写库）。用户点宿主链接或明确说
 * 「记住 / 加入自选 / 删掉」发起的**本地偏好保存**，那条消息本身就是确认，
 * 按配方直接 kv_read → kv_write → 回执，不要再要求一次确认、也不要先只给预览。
 */
const SKILL_FOOTER =
  '技能只是提示，实际能力以本轮工具为准；改动业务库 / 外部状态的写操作必须先给预览、结束本轮回复，等用户下一条消息明确确认后再提交；'
  + '用户点宿主链接或明确说「记住 / 加入自选 / 删掉」发起的本地偏好保存，那条消息本身就是确认，直接按技能说明读写并回执，不要再要一次确认。'
  + '涉及指路 / 打开页面时，链接一律由宿主以按钮注入；回复正文里绝不自己写任何 http(s) 网址或外站链接（尤其不要编造域名），只写一句简短引导语。'
  + '唯一例外：技能说明或工具观察里给出的宿主自定义 scheme markdown 链接（如 secret-prompt: / prefs-add: 开头，均非 http(s) 网址），'
  + '必须把那一条链接原样贴给用户，不改写、不补域名、不索要参数；除此之外不写任何链接。';

/** 每条技能的展示格式 */
function renderSkill(skill: SkillRecipe): string {
  return `- 名称：${skill.summary}\n  使用提示：${skill.prompt}`;
}

/**
 * 生成追加了**散文技能**说明的 system prompt。
 * 空 active / active 全是 workflow 配方 → 返回 base 本身（不拼接、不追加空行）。
 * 路由目录与 workflow 工具定义已经承载了 workflow 配方所需的全部路由词 / 填参信息。
 */
export function buildSkillSystemPrompt(base: string, active: readonly SkillRecipe[]): string {
  const prose = active.filter((s) => s.workflow === undefined);
  if (prose.length === 0) return base;
  const lines = ['本轮可用技能：', ...prose.map(renderSkill), SKILL_FOOTER];
  return `${base}\n\n${lines.join('\n')}`;
}
