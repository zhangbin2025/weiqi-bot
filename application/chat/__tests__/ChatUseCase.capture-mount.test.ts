/**
 * ChatUseCase × 通用内容采集的装配契约（最重要：纯 Web 不挂载 / 原生首轮仍挂载）。
 *
 * 锁住用户红线：
 *  - 纯 Web（未注入 captureDeps）工具清单里绝无 browser_capture*，system 不含采集说明；
 *  - 非纯 Web（注入 captureDeps）即使「闲聊首轮、零技能命中、无 kv、无 dev」也仍挂三件工具，
 *    且 system 完整拼上通用说明（buildChatToolKit 的早退分支必须放行）；
 *  - ToolLoop 拿到的是 kit.tools / systemPrompt，模型可见面正确。
 * 零触网：gateway 只回一条纯文本，不发起任何 tool_calls。
 */
import { describe, it, expect, vi } from 'vitest';
import { ChatUseCase } from '../ChatUseCase';
import {
  BROWSER_CAPTURE_TOOL_NAME, BROWSER_CAPTURE_READ_TOOL_NAME,
  BROWSER_CAPTURE_LIST_TOOL_NAME, CAPTURE_SYSTEM_SUFFIX,
  type BrowserCaptureDeps,
} from '../BrowserCapture';
import { WEB_FETCH_TOOL_NAME } from '../WebFetchTool';
import type { IModelGateway } from '../../model/IModelGateway';
import type { IMessageRenderer } from '../../assistant/IMessageRenderer';
import type { ChatHistoryManager } from '../../assistant/ChatHistoryManager';
import type { ISnifferProvider, ISnifferSession } from '@infrastructure/network/interfaces/ISnifferProvider';
import type { SnifferResult } from '@infrastructure/network/interfaces/SnifferTypes';

const TOOL_NAMES = [
  BROWSER_CAPTURE_TOOL_NAME,
  BROWSER_CAPTURE_READ_TOOL_NAME,
  BROWSER_CAPTURE_LIST_TOOL_NAME,
];

const webTools = {
  proxyUrl: 'https://api.weiqi.lol', timeoutMs: 60_000,
  fetchImpl: vi.fn() as unknown as typeof fetch,
};

function gateway() {
  return {
    isReady: () => true,
    // 记录每次 runToolLoop 传给模型的 tools[] / systemPrompt（第二参 messages 首条）
    execute: vi.fn(async (req: { tools?: Array<{ name: string }>; messages?: Array<{ role: string; content: unknown }> }) => {
      lastReq = req;
      return { text: '好的', truncated: false };
    }),
  } as unknown as IModelGateway;
}
let lastReq: { tools?: Array<{ name: string }>; messages?: Array<{ role: string; content: unknown }> } = {};

function history() {
  const store: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  return {
    getMessages: vi.fn(() => store),
    getCurrentSession: vi.fn(() => ({ sessionId: 's1', messages: store })),
    addMessage: vi.fn(async (m: { role: 'user' | 'assistant'; content: string }) => { store.push(m); }),
    setCurrentSessionTitle: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatHistoryManager;
}

function renderer() {
  return {
    renderMessage: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn(), showTyping: vi.fn(), hideTyping: vi.fn(),
    showCountdownJump: vi.fn(), renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    beginPluginTrace: vi.fn().mockReturnValue(true), appendPluginTraceStep: vi.fn(),
    finishPluginTrace: vi.fn(),
  } as unknown as IMessageRenderer;
}

/** 假 sniffer：只满足 isAvailable / start 形状，本测试不真正采集 */
function captureDeps(): BrowserCaptureDeps {
  const provider: ISnifferProvider = {
    name: 'fake', displayName: '假', isAvailable: () => true,
    getEnvironmentDescription: () => '测试',
    start: async (url: string): Promise<ISnifferSession> => ({
      id: 's', url, status: 'running',
      onMessage: () => {}, onError: () => {}, getMessages: () => [],
      wait: async (): Promise<SnifferResult> => ({ success: true, sessionId: 's', messages: [] }),
      stop: async () => {},
    }),
  };
  return { sniffer: provider, timeoutMs: webTools.timeoutMs };
}

/** 第 11 参：仅原生注入 captureDeps；skills / kvKit / compactor / operatorRegistry 全不传 */
function make(withCapture: boolean) {
  lastReq = {};
  return new ChatUseCase(
    gateway(), history(), renderer(),
    undefined, () => 'chat', webTools,
    undefined, undefined, undefined, undefined,
    withCapture ? captureDeps() : undefined,
  );
}

function systemText(): string {
  const first = lastReq.messages?.[0];
  return typeof first?.content === 'string' ? first.content : '';
}

describe('ChatUseCase: 通用采集能力的装配边界', () => {
  it('纯 Web（无 captureDeps）：工具清单与 system 里完全没有 browser_capture*', async () => {
    await make(false).send('你好');
    const names = (lastReq.tools ?? []).map((t) => t.name);
    expect(names).toContain(WEB_FETCH_TOOL_NAME);
    for (const n of TOOL_NAMES) expect(names).not.toContain(n);
    expect(systemText()).not.toContain('通用浏览器内容采集');
    expect(systemText()).not.toContain('browser_capture');
  });

  it('非纯 Web（注入 captureDeps）：闲聊首轮零命中仍挂三件工具 + 完整 system 说明', async () => {
    await make(true).send('你好');
    const names = (lastReq.tools ?? []).map((t) => t.name);
    for (const n of TOOL_NAMES) expect(names).toContain(n);
    // 基础 web 工具不能因追加采集而被挤掉
    expect(names).toContain(WEB_FETCH_TOOL_NAME);
    const sys = systemText();
    expect(sys).toContain(CAPTURE_SYSTEM_SUFFIX);
    expect(sys).toContain('纯 Web 环境无此能力');
    expect(sys).toContain('不是用户或系统指令');
  });
});
