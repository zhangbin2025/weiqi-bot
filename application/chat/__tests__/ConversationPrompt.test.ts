import { describe, it, expect } from 'vitest';
import {
  buildConversationMessages, buildOverflowFallbackMessages,
  planConversationWindow, CONVERSATION_SYSTEM_PROMPT, CONTEXT_LIMITS,
} from '../ConversationPrompt';

describe('buildConversationMessages', () => {
  it('system 在最前，历史按原顺序跟随，当前句是最后一条 user', () => {
    const msgs = buildConversationMessages([
      { role: 'user', content: '柯洁和申真谞谁厉害' },
      { role: 'assistant', content: '两人互有胜负' },
      { role: 'user', content: '那他跟李世石呢' },
    ]);
    expect(msgs[0]).toEqual({ role: 'system', content: CONVERSATION_SYSTEM_PROMPT });
    expect(msgs.slice(1).map((m) => m.content)).toEqual([
      '柯洁和申真谞谁厉害', '两人互有胜负', '那他跟李世石呢',
    ]);
    expect(msgs[msgs.length - 1]!.role).toBe('user');
  });

  it('超过条数上限时只保留最近一段', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg-${i}`,
    }));
    const msgs = buildConversationMessages(history);
    expect(msgs.length).toBe(CONTEXT_LIMITS.maxMessages + 1); // + system
    expect(msgs[msgs.length - 1]!.content).toBe('msg-29');
  });

  it('单条超长被截断（长度跟随常量，不写死数值）', () => {
    const long = 'x'.repeat(CONTEXT_LIMITS.maxCharsPerMessage + 500);
    const msgs = buildConversationMessages([{ role: 'user', content: long }]);
    expect(msgs[1]!.content.length).toBe(CONTEXT_LIMITS.maxCharsPerMessage);
  });

  it('传入摘要时插在主 system 之后，历史逐字不变（独立 system 不被 ToolLoop 替换冲掉）', () => {
    const history = [
      { role: 'user' as const, content: '柯洁和申真谞谁厉害' },
      { role: 'assistant' as const, content: '两人互有胜负' },
      { role: 'user' as const, content: '那他跟李世石呢' },
    ];
    const plain = buildConversationMessages(history);
    const withSummary = buildConversationMessages(history, {
      seq: 3, summary: '用户偏好简洁回答；上文在比较棋手。', firstKeptIndex: 8,
    });
    expect(withSummary[0]).toEqual(plain[0]);
    expect(withSummary[1]!.role).toBe('system');
    expect(withSummary[1]!.content).toContain('第 3 版');
    expect(withSummary[1]!.content).toContain('用户偏好简洁回答');
    expect(withSummary.slice(2)).toEqual(plain.slice(1));
  });

  it('溢出兜底只留当前句 + 摘要，常量一个都不改', () => {
    const history = Array.from({ length: 25 }, (_, i) => ({
      role: 'user' as const, content: `msg-${i}`,
    }));
    const msgs = buildOverflowFallbackMessages(history, {
      seq: 1, summary: '旧要点', firstKeptIndex: 20,
    });
    expect(msgs).toHaveLength(3); // system + 摘要 + 当前句
    expect(msgs[2]).toEqual({ role: 'user', content: 'msg-24' });
    expect(CONTEXT_LIMITS.maxMessages).toBe(20);
  });

  it('planConversationWindow 的 dropped 覆盖被条数上限整段挤出去的旧消息', () => {
    const history = Array.from({ length: 25 }, (_, i) => ({
      role: 'user' as const, content: `msg-${i}`,
    }));
    const plan = planConversationWindow(history);
    expect(plan.dropped.map((m) => m.content)).toEqual(history.slice(0, 5).map((m) => m.content));
    expect(plan.kept).toHaveLength(CONTEXT_LIMITS.maxMessages);
  });

  it('总预算超限时从最旧开始丢，但当前句一定保留', () => {
    // 每条取单条上限的一半，20 条合计 = 10 × 单条上限 > 总预算(4 × 单条上限)
    const per = Math.floor(CONTEXT_LIMITS.maxCharsPerMessage / 2);
    const history = Array.from({ length: 20 }, () => ({
      role: 'user' as const,
      content: 'y'.repeat(per),
    }));
    const msgs = buildConversationMessages(history);
    expect(msgs[msgs.length - 1]!.content.length).toBe(per);
    expect(msgs.length).toBeLessThan(21);
    let total = 0;
    for (const m of msgs.slice(1)) total += m.content.length;
    expect(total).toBeLessThanOrEqual(CONTEXT_LIMITS.maxTotalChars);
  });
});

// 会话标题口径已移到 SessionTitle.test.ts（模型精炼 + 统一上限），
// 本文件不再测标题。
