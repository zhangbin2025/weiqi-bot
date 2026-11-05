import { describe, it, expect, vi } from 'vitest';
import { ChatUseCase, isSlashCommand, SLASH_COMMAND_HINT, NOT_READY_HINT } from '../ChatUseCase';
import type { IModelGateway } from '../../model/IModelGateway';
import type { ChatHistoryManager } from '../../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../../assistant/IMessageRenderer';

function makeRenderer() {
  return {
    renderMessage: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn(),
    showTyping: vi.fn(),
    hideTyping: vi.fn(),
    showCountdownJump: vi.fn(),
  } as unknown as IMessageRenderer & { renderMessage: ReturnType<typeof vi.fn> };
}

function makeHistory(messages: Array<{ role: 'user' | 'assistant'; content: string }> = []) {
  const store = [...messages];
  return {
    getMessages: vi.fn(() => store),
    addMessage: vi.fn(async (m: { role: 'user' | 'assistant'; content: string }) => { store.push(m); }),
    setCurrentSessionTitle: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatHistoryManager & {
    getMessages: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
    setCurrentSessionTitle: ReturnType<typeof vi.fn>;
  };
}

function makeGateway(ready = true, text = '回复内容') {
  return {
    isReady: vi.fn(() => ready),
    execute: vi.fn().mockResolvedValue({ text, truncated: false }),
  } as unknown as IModelGateway & { execute: ReturnType<typeof vi.fn> };
}

describe('isSlashCommand', () => {
  it('识别斜杠开头（含前导空白）', () => {
    expect(isSlashCommand('/llm status')).toBe(true);
    expect(isSlashCommand('  /help')).toBe(true);
    expect(isSlashCommand('正常聊天')).toBe(false);
  });
});

describe('ChatUseCase.send', () => {
  it('斜杠开头只提示，不渲染用户气泡、不写历史、不调模型', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const gateway = makeGateway();
    await new ChatUseCase(gateway, history, renderer).send('/llm https://x sk-secret model');
    expect(renderer.renderMessage).toHaveBeenCalledWith(
      SLASH_COMMAND_HINT, false, null, null, undefined, undefined, false,
    );
    expect(history.addMessage).not.toHaveBeenCalled();
    expect(gateway.execute).not.toHaveBeenCalled();
  });

  it('未就绪时只提示，不写历史', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    await new ChatUseCase(makeGateway(false), history, renderer).send('你好');
    expect(renderer.renderMessage).toHaveBeenCalledWith(
      NOT_READY_HINT, false, null, null, undefined, undefined, false,
    );
    expect(history.addMessage).not.toHaveBeenCalled();
  });

  it('正常路径：user 与 assistant 成对写入历史，jsonMode=false', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const gateway = makeGateway(true, '两人互有胜负');
    await new ChatUseCase(gateway, history, renderer).send('柯洁和申真谞谁厉害');

    expect(history.addMessage).toHaveBeenNthCalledWith(1, { role: 'user', content: '柯洁和申真谞谁厉害' });
    expect(history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '两人互有胜负' });
    expect(history.setCurrentSessionTitle).toHaveBeenCalledTimes(1);
    const req = gateway.execute.mock.calls[0]![0];
    expect(req.task).toBe('chat.reply');
    expect(req.options.jsonMode).toBe(false);
    expect(req.messages[req.messages.length - 1]).toEqual({ role: 'user', content: '柯洁和申真谞谁厉害' });
    expect(renderer.showTyping).toHaveBeenCalledTimes(1);
    expect(renderer.hideTyping).toHaveBeenCalledTimes(1);
  });

  it('多轮：第二句带上了前一轮历史（上下文不再一问一答）', async () => {
    const renderer = makeRenderer();
    const history = makeHistory([
      { role: 'user', content: '柯洁和申真谞谁厉害' },
      { role: 'assistant', content: '两人互有胜负' },
    ]);
    const gateway = makeGateway();
    await new ChatUseCase(gateway, history, renderer).send('那他跟李世石呢');
    const req = gateway.execute.mock.calls[0]![0];
    const contents = req.messages.map((m: { content: string }) => m.content);
    expect(contents).toContain('柯洁和申真谞谁厉害');
    expect(contents).toContain('两人互有胜负');
    expect(contents[contents.length - 1]).toBe('那他跟李世石呢');
  });

  it('模型失败：只渲染错误，不把错误文案写进历史', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const gateway = makeGateway();
    gateway.execute.mockRejectedValue(new Error('超时'));
    await new ChatUseCase(gateway, history, renderer).send('你好');
    expect(history.addMessage).toHaveBeenCalledTimes(1); // 只有 user
    expect(renderer.hideTyping).toHaveBeenCalled();
    expect(renderer.renderMessage).toHaveBeenLastCalledWith(
      '❌ 对话失败：超时', false, null, null, undefined, undefined, false,
    );
  });
});
