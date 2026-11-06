import { describe, it, expect } from 'vitest';
import { buildAgentSystemPrompt, buildRepairMessages } from '../PluginPrompts';
import type { PluginContextEntry, RepairFeedback } from '@domain/plugin/types';

const snapshot: PluginContextEntry[] = [
  { id: 'plugin:1', name: '同分比胜局', pointId: 'ranking.tiebreak', enabled: true, version: 2, intent: '同分先看胜局数' },
  { id: 'plugin:2', name: '草稿', pointId: 'ranking.tiebreak', enabled: false, version: 1, intent: '按对手分' },
];

describe('buildAgentSystemPrompt', () => {
  it('声明可编程智能体身份与沙箱契约', () => {
    const s = buildAgentSystemPrompt(snapshot, 3);
    expect(s).toContain('可编程智能体');
    expect(s).toContain('无网络');
    expect(s).toContain('rank(players)');
    expect(s).toContain('rank');
  });

  it('列出全部插件的 id/name/pointId/enabled/version/intent', () => {
    const s = buildAgentSystemPrompt(snapshot, 3);
    expect(s).toContain('plugin:1');
    expect(s).toContain('同分比胜局');
    expect(s).toContain('ranking.tiebreak');
    expect(s).toContain('已启用');
    expect(s).toContain('停用');
    expect(s).toContain('v2');
    expect(s).toContain('同分先看胜局数');
    expect(s).toContain('plugin:2');
  });

  it('解释所有 action.kind 并要求严格 JSON', () => {
    const s = buildAgentSystemPrompt(snapshot, 3);
    for (const k of ['none', 'plugin.list', 'plugin.show', 'plugin.create', 'plugin.revise', 'plugin.toggle', 'plugin.delete']) {
      expect(s).toContain(k);
    }
    expect(s).toContain('"reply"');
    expect(s).toContain('"action"');
  });

  it('明确告知清单默认不含源码、要看源码用 plugin.show', () => {
    const s = buildAgentSystemPrompt(snapshot, 3);
    expect(s).toContain('plugin.show');
    expect(s).toContain('默认不含源码');
    expect(s).toContain('不要凭记忆编造代码');
  });

  it('命名规则：只有用户明确起名才给 name，否则系统自动排号', () => {
    const s = buildAgentSystemPrompt(snapshot, 3);
    expect(s).toContain('仅当用户明确为规则起了名字');
    expect(s).toContain('规则1');
    expect(s).toContain('不要自己编造花哨名称');
  });

  it('强调 create/revise 必须给完整 code、不要 diff', () => {
    const s = buildAgentSystemPrompt(snapshot, 3);
    expect(s).toContain('完整源码');
    expect(s).toContain('diff');
  });

  it('承接上文的省略指令：要求先 plugin.list 拿 id、禁止凭记忆猜', () => {
    const s = buildAgentSystemPrompt(snapshot, 3);
    expect(s).toContain('承接上文的省略指令');
    expect(s).toContain('必须先 plugin.list');
    expect(s).toContain('严禁凭开头清单或记忆猜 id');
    expect(s).toContain('新建/修订产生的候选默认停用');
  });

  it('修复轮数上限体现在 prompt 里', () => {
    expect(buildAgentSystemPrompt([], 5)).toContain('5');
    expect(buildAgentSystemPrompt([], 1)).toContain('1');
  });

  it('code 存在时附上源码，不存在时不出现「代码：」段', () => {
    const withCode = buildAgentSystemPrompt([{ ...snapshot[0]!, code: 'function rank(p){return p}' }], 3);
    expect(withCode).toContain('function rank');
    expect(withCode).toContain('代码：');
    const without = buildAgentSystemPrompt(snapshot, 3);
    expect(without).not.toContain('代码：');
  });

  it('空清单时给出明确提示而非报错', () => {
    expect(buildAgentSystemPrompt([], 3)).toContain('没有任何插件');
  });
});

describe('buildRepairMessages（工件中心）', () => {
  const code = 'function rank(p){ return p }';
  const fb: RepairFeedback = {
    phase: 'runtime', ok: false,
    error: { name: 'TypeError', message: "cannot read 'wins'", lineNumber: 3 },
    hint: '检查字段可能 undefined',
    attempt: 1, maxAttempts: 3,
  };

  it('只产出 system + user，不含任何会话/历史轮次', () => {
    const m = buildRepairMessages('同分比胜局', code, fb, 3);
    expect(m).toHaveLength(2);
    expect(m.map((x) => x.role)).toEqual(['system', 'user']);
    expect(m.some((x) => x.role === 'assistant')).toBe(false);
  });

  it('包含原始需求、当前完整源码、本轮反馈', () => {
    const m = buildRepairMessages('同分比胜局', code, fb, 3);
    const user = m[1]!.content;
    expect(user).toContain('同分比胜局');
    expect(user).toContain(code);
    expect(user).toContain('TypeError');
    expect(user).toContain("cannot read 'wins'");
    expect(user).toContain('行号=3');
    expect(user).toContain('检查字段可能 undefined');
    expect(user).toContain('1/3');
  });

  it('首次生成（无 code）标注「无」并要求全量代码', () => {
    const m = buildRepairMessages('写个规则', undefined, '请根据需求输出', 3);
    expect(m[1]!.content).toContain('无（首次生成）');
    expect(m[1]!.content).toContain('完整');
  });

  it('接受字符串反馈（用户验收原文）', () => {
    const m = buildRepairMessages('需求', code, '排反了，应该先比胜局', 3);
    expect(m[1]!.content).toContain('排反了，应该先比胜局');
  });

  it('反馈含输入摘要与用户文本时也带上', () => {
    const rich: RepairFeedback = { ...fb, inputShape: 'Array<3item> of {id,name,score}', userText: '第二行错了' };
    const user = buildRepairMessages('需求', code, rich, 3)[1]!.content;
    expect(user).toContain('Array<3item>');
    expect(user).toContain('第二行错了');
  });

  it('轮数上限出现在 system 里', () => {
    expect(buildRepairMessages('x', code, fb, 7)[0]!.content).toContain('7');
  });

  it('prompt 长度克制（不含历史，不重复拼接）', () => {
    const s = buildAgentSystemPrompt(snapshot, 3);
    const m = buildRepairMessages('x', code, fb, 3);
    expect(s.length).toBeLessThan(3000);
    expect(m[1]!.content.length).toBeLessThan(1500);
  });
});
