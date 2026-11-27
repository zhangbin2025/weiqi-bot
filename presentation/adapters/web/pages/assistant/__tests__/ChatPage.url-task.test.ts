import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from '../ChatPage';
import { ROLE_STORAGE_KEY } from '@application/chat/ChatRole';

function makePage() {
  const page = Object.create(ChatPage.prototype) as ChatPage & Record<string, any>;
  page.currentRole = 'dev';
  page.renderer = { renderMessage: vi.fn().mockResolvedValue(undefined) };
  page.newSession = vi.fn().mockResolvedValue(undefined);
  page.autoResize = vi.fn();
  page.handleSend = vi.fn().mockResolvedValue(undefined);
  return page;
}

beforeEach(() => {
  document.body.innerHTML = '<textarea id="userInput"></textarea>';
  localStorage.clear();
  localStorage.setItem(ROLE_STORAGE_KEY, 'dev');
});

describe('ChatPage URL task deep link', () => {
  it('creates a fresh chat-role session and submits the original URL to the LLM', async () => {
    const page = makePage();
    const url = 'https://example.org/game?id=123&view=full';

    await page.handleUrlTaskNavigation(url);

    const input = document.getElementById('userInput') as HTMLTextAreaElement;
    expect(page.currentRole).toBe('chat');
    expect(page.newSession).toHaveBeenCalledOnce();
    expect(input.value).toContain(url);
    expect(input.value).toContain('网页读取工具');
    expect(input.value).toContain('\n');
    expect(page.handleSend).toHaveBeenCalledOnce();
    // 本次会话固定为 chat，但不覆盖用户下次新建会话时的默认角色偏好。
    expect(localStorage.getItem(ROLE_STORAGE_KEY)).toBe('dev');
  });

  it('rejects non-http URLs without creating a session or sending a request', async () => {
    const page = makePage();

    await page.handleUrlTaskNavigation('javascript:alert(1)');

    expect(page.newSession).not.toHaveBeenCalled();
    expect(page.handleSend).not.toHaveBeenCalled();
    expect(page.renderer.renderMessage).toHaveBeenCalledWith(
      '目前只支持读取 http / https 网页链接。',
      false, null, null, undefined, undefined, false,
    );
  });
});
