/**
 * AssistantRenderer：LLM 聊天回复用普通消息块 + 「聊天」意图标识
 * 分类/识别/跳转规则不受影响，这里只锁「显示」行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssistantRenderer } from '../AssistantRenderer';

vi.mock('marked', () => ({
  marked: {
    setOptions: vi.fn(),
    parse: vi.fn(async (t: string) => `<p>${t}</p>`),
  },
}));

describe('AssistantRenderer 聊天意图标识', () => {
  let renderer: AssistantRenderer;

  beforeEach(() => {
    document.body.innerHTML = '<div id="chatContainer"></div>';
    Element.prototype.scrollIntoView = vi.fn();
    renderer = new AssistantRenderer();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  const firstMessage = () => document.querySelector('#chatContainer .message') as HTMLElement;

  it('variant=chat：普通消息块 + 「聊天」徽章，无 chat class', async () => {
    await renderer.renderMessage('是呀，天气好适合摆一盘棋', false, null, null,
      undefined, undefined, false, undefined, undefined, 'chat');
    const msg = firstMessage();
    expect(msg.className).toBe('message assistant');           // 样式完全普通
    const badges = msg.querySelectorAll('.intent-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe('聊天');
  });

  it('不传 variant 的普通助手消息没有徽章', async () => {
    await renderer.renderMessage('一条普通回复', false, null, null,
      undefined, undefined, false);
    expect(firstMessage().querySelectorAll('.intent-badge').length).toBe(0);
  });

  it('功能意图徽章照旧用 INTENT_CONFIG 中文名', async () => {
    await renderer.renderMessage('已为你跳转', false, 'query_player', { player: '柯洁' });
    expect(firstMessage().querySelector('.intent-badge')?.textContent).toBe('查询棋手');
  });

  it('旧历史数据 intent=chat 也显示「聊天」而非英文，且不重复', async () => {
    await renderer.renderMessage('旧闲聊', false, 'chat', null,
      undefined, undefined, false, undefined, undefined, 'chat');
    const badges = firstMessage().querySelectorAll('.intent-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe('聊天');
  });

  it('用户消息即使带 variant 也不显示徽章', async () => {
    await renderer.renderMessage('你好', true, null, null,
      undefined, undefined, false, undefined, undefined, 'chat');
    expect(firstMessage().className).toContain('user');
    expect(firstMessage().querySelectorAll('.intent-badge').length).toBe(0);
  });

  it('prependMessage（历史/懒加载）同样显示「聊天」徽章', async () => {
    await renderer.prependMessage('聊点什么吧', false, null, null,
      undefined, undefined, undefined, undefined, 'chat');
    expect(firstMessage().querySelector('.intent-badge')?.textContent).toBe('聊天');
  });

  it('prependMessage 功能意图仍显示中文徽章', async () => {
    await renderer.prependMessage('功能消息', false, 'query_player', null);
    expect(firstMessage().querySelector('.intent-badge')?.textContent).toBe('查询棋手');
  });
});
