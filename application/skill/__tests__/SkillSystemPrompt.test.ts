/**
 * SkillSystemPrompt：空命中零额外 token；命中时的指路契约兜底。
 * 与 buildSkillSystemPrompt 的行为一一对应，不依赖 DOM / 网络。
 */
import { describe, it, expect } from 'vitest';
import { buildSkillSystemPrompt } from '../SkillSystemPrompt';
import type { SkillRecipe } from '../SkillTypes';

const base = 'BASE_SYSTEM_PROMPT';

function recipe(): SkillRecipe {
  return {
    schemaVersion: 1, id: 'user.demo', version: 1, name: '示例',
    summary: '摘要', triggers: ['触发'], primitives: ['navigate_to'], prompt: '提示',
  };
}

describe('buildSkillSystemPrompt', () => {
  it('active 为空：逐字返回 base，零额外 token（闲聊路径不受影响）', () => {
    expect(buildSkillSystemPrompt(base, [])).toBe(base);
    expect(buildSkillSystemPrompt(base, [])).not.toContain('本轮可用技能');
  });

  it('回归 2026-11-16：命中技能时，指路契约在工具被调用之前就送达', () => {
    const out = buildSkillSystemPrompt(base, [recipe()]);
    expect(out.startsWith(`${base}\n\n`)).toBe(true);
    expect(out).toContain('链接一律由宿主以按钮注入');
    expect(out).toContain('回复正文里绝不写任何网址或链接');
    expect(out).toContain('尤其不要编造域名');
  });

  it('既有「写操作先预览等确认」尾句完整保留', () => {
    expect(buildSkillSystemPrompt(base, [recipe()])).toContain(
      '技能只是提示，实际能力以本轮工具为准；写操作必须先给预览、结束本轮回复，等用户下一条消息明确确认后再提交。',
    );
  });
});
