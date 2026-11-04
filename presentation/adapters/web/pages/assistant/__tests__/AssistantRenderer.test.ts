/**
 * AssistantRenderer：chat 与普通助手消息完全一致（无专属气泡、无意图徽章）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssistantRenderer } from '../AssistantRenderer';

vi.mock('marked', () => ({
  marked: {
    setOptions: vi.fn(),
    parse: vi.fn(async (t: string) => `<p>${t}</p>`),
  },
}));

describe('AssistantRenderer 聊天消息样式', () => {
  let renderer: AssistantRenderer;

  beforeEach(() => {
    document.body.innerHTML = '<div id="chatContainer"></div>';
    Element.prototype.scrollIntoView = vi.fn();
    renderer = new AssistantRenderer();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  const firstMessage = () => document.querySelector('#chatContainer .message') as HTMLElement;

  it('chat 消息无 chat class、无意图徽章', async () => {
    await renderer.renderMessage('是呀，天气好适合摆一盘棋', false, null, null,
      undefined, undefined, false);
    const msg = firstMessage();
    expect(msg.className).toBe('message assistant');
    expect(msg.querySelector('.intent-badge')).toBeNull();
  });

  it('历史脏数据 intent=chat / variant=chat 也不产生徽章或 chat class', async () => {
    await renderer.renderMessage('旧闲聊', false, 'chat', null,
      undefined, undefined, false, undefined, undefined, 'chat');
    const msg = firstMessage();
    expect(msg.className).toBe('message assistant');
    expect(msg.querySelector('.intent-badge')).toBeNull();
  });

  it('功能意图仍显示中文徽章，不受 chat 影响', async () => {
    await renderer.renderMessage('已为你跳转', false, 'query_player', { player: '柯洁' });
    expect(firstMessage().querySelector('.intent-badge')?.textContent).toBe('查询棋手');
  });

  it('用户消息不显示意图徽章', async () => {
    await renderer.renderMessage('你好', true, 'chat', null,
      undefined, undefined, false);
    expect(firstMessage().className).toContain('user');
    expect(firstMessage().querySelector('.intent-badge')).toBeNull();
  });

  it('prependMessage：chat 普通块、无徽章', async () => {
    await renderer.prependMessage('聊点什么吧', false, 'chat', null,
      undefined, undefined, undefined, undefined, 'chat');
    const msg = firstMessage();
    expect(msg.className).toBe('message assistant');
    expect(msg.querySelector('.intent-badge')).toBeNull();
  });

  it('prependMessage 功能意图仍显示徽章', async () => {
    await renderer.prependMessage('功能消息', false, 'query_player', null);
    expect(firstMessage().querySelector('.intent-badge')?.textContent).toBe('查询棋手');
  });
});
