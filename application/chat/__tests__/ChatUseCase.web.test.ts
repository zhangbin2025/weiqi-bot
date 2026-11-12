/**
 * ChatUseCase × 标准 tool-calling 智能体接线回归
 * 锁住：chat 角色装配 webTools 后走 WebToolLoop；纯闲聊不挂「访问过程」块；
 * 真正访问了网页才亮过程块，且标题与插件调试块区分。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatUseCase } from '../ChatUseCase';
import { WEB_FETCH_TOOL_NAME } from '../WebFetchTool';
import type { IModelGateway } from '../../model/IModelGateway';
import type { IMessageRenderer } from '../../assistant/IMessageRenderer';
import type { ChatHistoryManager } from '../../assistant/ChatHistoryManager';

function renderer() {
  return {
    renderMessage: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn(), showTyping: vi.fn(), hideTyping: vi.fn(),
    showCountdownJump: vi.fn(),
    renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    beginPluginTrace: vi.fn().mockReturnValue(true),
    appendPluginTraceStep: vi.fn(),
    finishPluginTrace: vi.fn(),
  } as unknown as IMessageRenderer & {
    beginPluginTrace: ReturnType<typeof vi.fn>;
    appendPluginTraceStep: ReturnType<typeof vi.fn>;
    renderPluginTrace: ReturnType<typeof vi.fn>;
  };
}

function history() {
  const store: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  return {
    getMessages: vi.fn(() => store),
    addMessage: vi.fn(async (m: { role: 'user' | 'assistant'; content: string }) => { store.push(m); }),
    setCurrentSessionTitle: vi.fn().mockResolvedValue(undefined),
    getCurrentSession: vi.fn(() => null),
  } as unknown as ChatHistoryManager;
}

const webTools = {
  proxyUrl: 'https://api.weiqi.lol', timeoutMs: 60_000,
  fetchImpl: vi.fn(async () => ({
    ok: true, status: 200, statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/html' }),
    text: async () => '<html>柯洁</html>',
  })) as unknown as typeof fetch,
};

function gateway(steps: Array<{ text: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>) {
  let i = 0;
  return {
    isReady: () => true,
    execute: vi.fn(async () => steps[Math.min(i++, steps.length - 1)]!),
  } as unknown as IModelGateway;
}

function make(gw: IModelGateway, r: ReturnType<typeof renderer>) {
  return new ChatUseCase(gw, history(), r, undefined, () => 'chat', webTools);
}

describe('ChatUseCase: chat 角色的网络智能体接线', () => {
  beforeEach(() => {
    // webTools.fetchImpl 是模块级共享 spy，用例间必须清空调用记录
    webTools.fetchImpl.mockClear();
  });
  it('纯闲聊（无 tool_calls）→ 不挂任何「访问过程」块', async () => {
    const r = renderer();
    await make(gateway([{ text: '你好呀' }]), r).send('你好');
    expect(r.beginPluginTrace).not.toHaveBeenCalled();
    expect(r.renderPluginTrace).not.toHaveBeenCalled();
    expect(r.appendPluginTraceStep).not.toHaveBeenCalled();
  });

  it('模型调 web_fetch → 亮过程块，标题是「访问过程」且步骤带 URL', async () => {
    const r = renderer();
    const gw = gateway([
      { text: '', toolCalls: [{ id: 'c1', name: WEB_FETCH_TOOL_NAME, arguments: '{"url":"https://example.com/"}' }] },
      { text: '网页讲的是柯洁。来源：https://example.com/' },
    ]);
    await make(gw, r).send('归纳这个网页 https://example.com/');
    expect(r.beginPluginTrace).toHaveBeenCalledWith(expect.stringContaining('访问过程'));
    expect(r.appendPluginTraceStep).toHaveBeenCalled();
    const appended = r.appendPluginTraceStep.mock.calls.flatMap((c) => c[0] as Array<{ source: string; detail: string }>);
    expect(appended.some((s) => s.source === 'web' && s.detail.includes('https://example.com/'))).toBe(true);
    expect(r.finishPluginTrace).toHaveBeenCalled();
  });

  it('plugin 角色装配 webTools 也不碰网络工具（走 Agent）', async () => {
    const r = renderer();
    const agent = {
      turn: vi.fn().mockResolvedValue({ reply: '插件已建好', acted: true, attempts: 1 }),
      safeReply: vi.fn((t: string) => t),
    };
    const uc = new ChatUseCase(gateway([{ text: 'ignored' }]), history(), r, agent, () => 'plugin', webTools);
    await uc.send('写个规则');
    expect(agent.turn).toHaveBeenCalled();
    expect(webTools.fetchImpl).not.toHaveBeenCalled();
  });
});
