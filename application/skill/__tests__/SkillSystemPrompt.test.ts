/**
 * SkillSystemPrompt：空命中零额外 token；命中时的指路契约兜底。
 * 与 buildSkillSystemPrompt 的行为一一对应，不依赖 DOM / 网络。
 */
import { describe, it, expect } from 'vitest';
import { buildSkillSystemPrompt } from '../SkillSystemPrompt';
import type { SkillRecipe, WorkflowSpec } from '../SkillTypes';

const base = 'BASE_SYSTEM_PROMPT';

function recipe(over: Partial<SkillRecipe> = {}): SkillRecipe {
  return {
    schemaVersion: 1, id: 'user.demo', version: 1, name: '示例',
    summary: '摘要', primitives: ['navigate_to'], prompt: '提示',
    ...over,
  };
}

/** 最小合法 workflow 声明；本文件只关心「带 workflow 就不进 system」这一判据 */
const workflow: WorkflowSpec = {
  steps: [{ id: 'only', call: 'display_json_list' }],
};

describe('buildSkillSystemPrompt', () => {
  it('active 为空：逐字返回 base，零额外 token（闲聊路径不受影响）', () => {
    expect(buildSkillSystemPrompt(base, [])).toBe(base);
    expect(buildSkillSystemPrompt(base, [])).not.toContain('本轮可用技能');
  });

  it('回归 2026-11-16：命中技能时，指路契约在工具被调用之前就送达', () => {
    const out = buildSkillSystemPrompt(base, [recipe()]);
    expect(out.startsWith(`${base}\n\n`)).toBe(true);
    expect(out).toContain('链接一律由宿主以按钮注入');
    expect(out).toContain('绝不自己写任何 http(s) 网址或外站链接');
    expect(out).toContain('尤其不要编造域名');
  });

  it('回归 2026-11-19：宿主自定义 scheme 链接（凭据 / 自选）允许原样转贴，不自造网址', () => {
    const out = buildSkillSystemPrompt(base, [recipe()]);
    expect(out).toContain('secret-prompt:');
    expect(out).toContain('prefs-add:');
    expect(out).toContain('把那一条链接原样贴给用户');
    expect(out).toContain('不改写、不补域名、不索要参数');
    // 禁令仍在，只是收窄到「自己编的 http(s) 外站网址」
    expect(out).toContain('除此之外不写任何链接');
  });

  it('既有「写操作先预览等确认」尾句完整保留', () => {
    expect(buildSkillSystemPrompt(base, [recipe()])).toContain(
      '技能只是提示，实际能力以本轮工具为准；改动业务库 / 外部状态的写操作必须先给预览、结束本轮回复，等用户下一条消息明确确认后再提交；',
    );
  });

  it('回归 2026-11-19：本地偏好保存不需要二次确认（点链接那条用户消息本身即确认）', () => {
    const out = buildSkillSystemPrompt(base, [recipe()]);
    expect(out).toContain('那条消息本身就是确认');
    expect(out).toContain('不要再要一次确认');
    // 两阶段写库的闸门仍在，没有被整条删掉
    expect(out).toContain('等用户下一条消息明确确认后再提交');
  });

  it('空命中仍然零额外 token（新尾句不进闲聊）', () => {
    const out = buildSkillSystemPrompt(base, []);
    expect(out).toBe(base);
    expect(out).not.toContain('本地偏好保存');
  });

  // 2026-11-23：LLM 不再碰业务数据 / token 最小化。
  // 触发条件在路由目录那一行，填参契约在 run_workflow 工具定义，
  // workflow 配方命中不再需要整段说明书进 system。
  it('带 workflow 的配方命中：逐字返回 base，零额外 token', () => {
    const wf = recipe({
      id: 'stock.news.10jqka', name: '财经新闻',
      summary: '工作流触发条件（不该进 system）',
      prompt: '工作流整段说明书（不该进 system）',
      primitives: [], workflow,
    });
    const out = buildSkillSystemPrompt(base, [wf]);
    expect(out).toBe(base);
    expect(out).not.toContain('本轮可用技能');
    expect(out).not.toContain('工作流触发条件');
    expect(out).not.toContain('工作流整段说明书');
    expect(out).not.toContain('技能只是提示');
  });

  it('散文 + workflow 混合命中：只渲染散文，SKILL_FOOTER 仍随散文送达一次', () => {
    const prose = recipe({ summary: '散文摘要', prompt: '散文提示' });
    const wf = recipe({
      id: 'stock.news.10jqka', summary: '工作流触发条件',
      prompt: '工作流整段说明书', primitives: [], workflow,
    });
    const out = buildSkillSystemPrompt(base, [prose, wf]);
    expect(out.startsWith(`${base}\n\n`)).toBe(true);
    expect(out).toContain('- 名称：散文摘要\n  使用提示：散文提示');
    expect(out).not.toContain('工作流触发条件');
    expect(out).not.toContain('工作流整段说明书');
    // 尾句与指路契约仍原样保留（散文路径行为不变）
    expect(out).toContain('技能只是提示，实际能力以本轮工具为准');
    expect(out).toContain('链接一律由宿主以按钮注入');
  });

  it('散文单独命中：行为与收窄前逐字一致（回归护栏）', () => {
    const out = buildSkillSystemPrompt(base, [recipe()]);
    expect(out.startsWith(`${base}\n\n本轮可用技能：\n- 名称：摘要\n  使用提示：提示\n`)).toBe(true);
    // 尾句紧接技能块，结构未被拆分或重排
    expect(out).toContain('使用提示：提示\n技能只是提示，实际能力以本轮工具为准');
  });
});
