import { describe, it, expect } from 'vitest';
import {
  buildConversationMessages, summarizeSession, CONVERSATION_SYSTEM_PROMPT, CONTEXT_LIMITS,
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

  it('单条超长被截断', () => {
    const long = 'x'.repeat(3000);
    const msgs = buildConversationMessages([{ role: 'user', content: long }]);
    expect(msgs[1]!.content.length).toBe(CONTEXT_LIMITS.maxCharsPerMessage);
  });

  it('总预算超限时从最旧开始丢，但当前句一定保留', () => {
    const history = Array.from({ length: 10 }, () => ({
      role: 'user' as const,
      content: 'y'.repeat(1500),
    }));
    const msgs = buildConversationMessages(history);
    expect(msgs[msgs.length - 1]!.content.length).toBe(1500);
    expect(msgs.length).toBeLessThan(11);
    let total = 0;
    for (const m of msgs.slice(1)) total += m.content.length;
    expect(total).toBeLessThanOrEqual(CONTEXT_LIMITS.maxTotalChars);
  });
});

describe('summarizeSession', () => {
  it('取第一条 user 消息，压平空白', () => {
    expect(summarizeSession([
      { role: 'user', content: '  柯洁和\n申真谞  交战如何  ' },
      { role: 'assistant', content: '略' },
    ])).toBe('柯洁和 申真谞 交战如何');
  });

  it('超过 30 字截断加省略号', () => {
    const s = summarizeSession([{ role: 'user', content: '啊'.repeat(50) }]);
    expect(s.endsWith('...')).toBe(true);
    expect(s.length).toBe(33);
  });

  it('没有 user 消息时回落「新对话」', () => {
    expect(summarizeSession([{ role: 'assistant', content: 'hi' }])).toBe('新对话');
    expect(summarizeSession([])).toBe('新对话');
  });
});
