/**
 * AssistantRenderer 闲聊变体样式测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssistantRenderer } from '../AssistantRenderer';

// marked 走动态 import，这里 mock 掉，避免依赖真实模块与网络
vi.mock('marked', () => ({
  marked: {
    setOptions: vi.fn(),
    parse: vi.fn(async (t: string) => `<p>${t}</p>`),
  },
}));

describe('AssistantRenderer 闲聊变体', () => {
  let renderer: AssistantRenderer;

  beforeEach(() => {
    document.body.innerHTML = '<div id="chatContainer"></div>';
    // jsdom 未实现 scrollIntoView（真实浏览器有），测试里 stub 掉
    Element.prototype.scrollIntoView = vi.fn();
    renderer = new AssistantRenderer();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  const firstMessage = () => document.querySelector('#chatContainer .message') as HTMLElement;

  it('variant=chat 的助手消息带 chat class', async () => {
    await renderer.renderMessage(
      '是呀，天气好适合摆一盘棋', false, null, null,
      undefined, undefined, false, undefined, undefined, 'chat',
    );
    expect(firstMessage().className).toContain('chat');
    expect(firstMessage().className).toContain('assistant');
  });

  it('不传 variant 的助手消息不带 chat class（功能消息保持原样）', async () => {
    await renderer.renderMessage('已为你跳转', false, 'query_player', { player: '柯洁' });
    expect(firstMessage().className).not.toContain('chat');
  });

  it('用户消息即使传 chat 也不加 chat class', async () => {
    await renderer.renderMessage(
      '你好', true, null, null,
      undefined, undefined, false, undefined, undefined, 'chat',
    );
    expect(firstMessage().className).not.toContain('chat');
    expect(firstMessage().className).toContain('user');
  });

  it('prependMessage 同样支持 chat（懒加载历史不丢样式）', async () => {
    await renderer.prependMessage(
      '聊点什么吧', false, null, null,
      undefined, undefined, undefined, undefined, 'chat',
    );
    expect(firstMessage().className).toContain('chat');
  });

  it('prependMessage 不传 variant 时不加 chat class', async () => {
    await renderer.prependMessage('功能消息', false, null, null);
    expect(firstMessage().className).not.toContain('chat');
  });
});
