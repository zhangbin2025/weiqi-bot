/**
 * ChatUseCase 测试 —— 统一 tool-calling loop 版
 *
 * 两个角色共用同一个 ToolLoop，差别只是「挂哪套工具 + 哪段 system + 过程块标题」：
 * - chat：createWebToolKit（或降级单次纯文本），system = CONVERSATION_SYSTEM_PROMPT
 * - plugin：注入的 ToolKit（插件工具表 + 动态 system），source='plugin'
 *
 * 因此旧文件里那批「白名单措辞 / JSON 动作协议 / 双层循环 / verifier」用例全部删除，
 * 换成「角色决定工具集」「工具调用才亮过程块」「安全边界不因合并分流被绕过」的回归。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ChatUseCase, isSlashCommand,
  SLASH_COMMAND_HINT, NOT_READY_HINT, AGENT_UNAVAILABLE_HINT,
} from '../ChatUseCase';
import { CONVERSATION_SYSTEM_PROMPT } from '../ConversationPrompt';
import { DEFAULT_PLUGIN_MAX_ATTEMPTS } from '../../plugin/PluginConfig';
import type { ToolKit } from '../ToolLoop';
import type { ChatRoleId } from '../ChatRole';
import type { IModelGateway, ModelResult } from '../../model/IModelGateway';
import type { ChatHistoryManager } from '../../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../../assistant/IMessageRenderer';

function makeRenderer() {
  return {
    renderMessage: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn(),
    showTyping: vi.fn(),
    hideTyping: vi.fn(),
    showCountdownJump: vi.fn(),
    renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    beginPluginTrace: vi.fn().mockReturnValue(true),
    appendPluginTraceStep: vi.fn(),
    finishPluginTrace: vi.fn(),
  } as unknown as IMessageRenderer & {
    renderMessage: ReturnType<typeof vi.fn>;
    renderPluginTrace: ReturnType<typeof vi.fn>;
    beginPluginTrace: ReturnType<typeof vi.fn>;
    appendPluginTraceStep: ReturnType<typeof vi.fn>;
    finishPluginTrace: ReturnType<typeof vi.fn>;
  };
}

function makeHistory(messages: Array<{ role: 'user' | 'assistant'; content: string }> = []) {
  const store = [...messages];
  return {
    store,
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

/** 一个最小插件工具集：只声明一个工具，system 动态生成 */
function makePluginKit(overrides: Partial<ToolKit> = {}): ToolKit {
  return {
    tools: [{ name: 'plugin_list', description: '列出插件', parameters: { type: 'object' } }],
    executors: {
      plugin_list: async () => ({ observation: '当前没有任何插件', ok: true, detail: '列出插件' }),
    },
    systemPrompt: () => Promise.resolve('你是插件开发智能体'),
    maxTurns: DEFAULT_PLUGIN_MAX_ATTEMPTS + 1,
    ...overrides,
  };
}

/** 角色 provider：默认闲聊 */
function role(id: ChatRoleId = 'chat'): () => ChatRoleId {
  return () => id;
}

function make(opts: {
  roleId?: ChatRoleId;
  kit?: ToolKit | undefined;
  gateway?: ReturnType<typeof makeGateway>;
  history?: ReturnType<typeof makeHistory>;
  renderer?: ReturnType<typeof makeRenderer>;
  webTools?: boolean;
}) {
  const renderer = opts.renderer ?? makeRenderer();
  const history = opts.history ?? makeHistory();
  const gateway = opts.gateway ?? makeGateway();
  const webTools = opts.webTools
    ? { proxyUrl: 'https://api.weiqi.lol', timeoutMs: 60_000, fetchImpl: vi.fn() as unknown as typeof fetch }
    : undefined;
  const useCase = new ChatUseCase(
    gateway, history, renderer, opts.kit, role(opts.roleId ?? 'chat'), webTools,
  );
  return { renderer, history, gateway, webTools, useCase };
}

describe('isSlashCommand', () => {
  it('识别斜杠开头（含前导空白）', () => {
    expect(isSlashCommand('/llm status')).toBe(true);
    expect(isSlashCommand('  /help')).toBe(true);
    expect(isSlashCommand('正常聊天')).toBe(false);
  });
});

describe('ChatUseCase.send — 基础设施（两个角色共通）', () => {
  it('斜杠开头只提示，不渲染用户气泡、不写历史、不调模型', async () => {
    const h = make({});
    await h.useCase.send('/llm status');
    expect(h.renderer.renderMessage).toHaveBeenCalledWith(
      SLASH_COMMAND_HINT, false, null, null, undefined, undefined, false,
    );
    expect(h.history.addMessage).not.toHaveBeenCalled();
    expect(h.gateway.execute).not.toHaveBeenCalled();
  });

  it('未就绪时只提示，不写历史', async () => {
    const h = make({ gateway: makeGateway(false) });
    await h.useCase.send('你好');
    expect(h.renderer.renderMessage).toHaveBeenCalledWith(
      NOT_READY_HINT, false, null, null, undefined, undefined, false,
    );
    expect(h.history.addMessage).not.toHaveBeenCalled();
  });

  it('正常路径：user 与 assistant 成对写入历史，jsonMode=false（纯文本降级分支）', async () => {
    const h = make({ gateway: makeGateway(true, '两人互有胜负') });
    await h.useCase.send('柯洁和申真谞谁厉害');
    expect(h.history.addMessage).toHaveBeenNthCalledWith(1, { role: 'user', content: '柯洁和申真谞谁厉害' });
    expect(h.history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '两人互有胜负' });
    expect(h.history.setCurrentSessionTitle).toHaveBeenCalledTimes(1);
    const req = h.gateway.execute.mock.calls[0]![0];
    expect(req.task).toBe('chat.reply');
    expect(req.options.jsonMode).toBe(false);
    expect(req.messages[0]).toEqual({ role: 'system', content: CONVERSATION_SYSTEM_PROMPT });
    expect(req.messages[req.messages.length - 1]).toEqual({ role: 'user', content: '柯洁和申真谞谁厉害' });
    expect(h.renderer.showTyping).toHaveBeenCalledTimes(1);
    expect(h.renderer.hideTyping).toHaveBeenCalledTimes(1);
  });

  it('多轮：第二句带上了前一轮历史（上下文不再一问一答）', async () => {
    const h = make({
      history: makeHistory([
        { role: 'user', content: '柯洁和申真谞谁厉害' },
        { role: 'assistant', content: '两人互有胜负' },
      ]),
    });
    await h.useCase.send('那他跟李世石呢');
    const contents = h.gateway.execute.mock.calls[0]![0].messages.map((m: { content: string }) => m.content);
    expect(contents).toContain('柯洁和申真谞谁厉害');
    expect(contents).toContain('两人互有胜负');
    expect(contents[contents.length - 1]).toBe('那他跟李世石呢');
  });

  it('模型失败：只渲染错误，不把错误文案写进历史', async () => {
    const gateway = makeGateway();
    gateway.execute.mockRejectedValue(new Error('超时'));
    const h = make({ gateway });
    await h.useCase.send('你好');
    expect(h.history.addMessage).toHaveBeenCalledTimes(1); // 只有 user
    expect(h.renderer.hideTyping).toHaveBeenCalled();
    expect(h.renderer.renderMessage).toHaveBeenLastCalledWith(
      '❌ 对话失败：超时', false, null, null, undefined, undefined, false,
    );
  });
});

describe('ChatUseCase.send — 角色决定工具集（核心回归）', () => {
  it('闲聊角色不挂插件工具：即使注入了 kit，也只调一次网关、不执行插件工具', async () => {
    for (const text of ['启用', '写个规则', '查看插件', '你好']) {
      const kit = makePluginKit();
      const h = make({ roleId: 'chat', kit });
      await h.useCase.send(text);
      expect(h.gateway.execute, text).toHaveBeenCalledTimes(1);
      expect(h.renderer.beginPluginTrace, text).not.toHaveBeenCalled();
    }
  });

  it('插件角色挂插件工具集，system 用工具集的动态文本、source 标 plugin', async () => {
    const gw = makeGateway();
    // 让 loop 第一轮就收敛（不给 tool_calls），这样能检查发出的 system/tools
    gw.execute.mockResolvedValue({ text: '已就绪', truncated: false } as ModelResult);
    const kit = makePluginKit();
    const h = make({ roleId: 'plugin', kit, gateway: gw });
    await h.useCase.send('你好');
    const req = gw.execute.mock.calls[0]![0];
    expect(req.messages[0]).toEqual({ role: 'system', content: '你是插件开发智能体' });
    expect(req.tools.map((t: { name: string }) => t.name)).toContain('plugin_list');
    expect(req.options?.jsonMode).toBeUndefined(); // 标准 tool-calling 不启用 jsonMode
  });

  it('插件角色工具调用 → 过程块标题「插件开发过程」，步骤 source=plugin', async () => {
    const gw = makeGateway();
    gw.execute
      .mockResolvedValueOnce({
        text: '', truncated: false,
        toolCalls: [{ id: 'c1', name: 'plugin_list', arguments: '{}' }],
      } as ModelResult)
      .mockResolvedValueOnce({ text: '列好了', truncated: false } as ModelResult);
    const h = make({ roleId: 'plugin', kit: makePluginKit(), gateway: gw });
    await h.useCase.send('看看有哪些插件');
    expect(h.renderer.beginPluginTrace).toHaveBeenCalledWith(expect.stringContaining('插件开发过程'));
    const appended = h.renderer.appendPluginTraceStep.mock.calls.map((c) => c[0]);
    expect(appended.some((s: { source: string; phase: string }) =>
      s.source === 'plugin' && s.phase === 'observe')).toBe(true);
    expect(h.renderer.finishPluginTrace).toHaveBeenCalledWith(true);
  });

  it('两个角色复用同一 loop：无工具调用时都不建过程块（懒建）', async () => {
    for (const roleId of ['chat', 'plugin'] as const) {
      const gw = makeGateway(true, '纯文本回复');
      const h = make({ roleId, ...(roleId === 'plugin' ? { kit: makePluginKit() } : {}), gateway: gw });
      await h.useCase.send('你好');
      expect(h.renderer.beginPluginTrace, roleId).not.toHaveBeenCalled();
      expect(h.renderer.renderPluginTrace, roleId).not.toHaveBeenCalled();
    }
  });

  it('不传 roleProvider 时默认闲聊（向后兼容旧调用方）', async () => {
    const renderer = makeRenderer();
    const gateway = makeGateway();
    await new ChatUseCase(gateway, makeHistory(), renderer, makePluginKit()).send('写个规则');
    expect(gateway.execute).toHaveBeenCalledTimes(1);
  });

  it('角色可在会话中途切换：同一实例先闲聊后插件，各自走对工具集', async () => {
    const renderer = makeRenderer();
    const gateway = makeGateway();
    let current: ChatRoleId = 'chat';
    const useCase = new ChatUseCase(
      gateway, makeHistory(), renderer, makePluginKit(), () => current,
    );
    await useCase.send('你好'); // 闲聊：纯文本降级，一次网关
    expect(gateway.execute).toHaveBeenCalledTimes(1);
    current = 'plugin';
    await useCase.send('你好'); // 插件角色：动态 system
    const req = gateway.execute.mock.calls[1]![0];
    expect(req.messages[0]).toEqual({ role: 'system', content: '你是插件开发智能体' });
  });

  it('选了插件角色但插件系统没装配 → 明确提示，不静默降级成闲聊', async () => {
    const h = make({ roleId: 'plugin', kit: undefined });
    await h.useCase.send('启用');
    expect(h.gateway.execute).not.toHaveBeenCalled();
    expect(h.renderer.renderMessage).toHaveBeenLastCalledWith(
      AGENT_UNAVAILABLE_HINT, false, null, null, undefined, undefined, false,
    );
    expect(h.history.addMessage).toHaveBeenCalledTimes(1); // 用户消息仍落盘
  });

  it('回复无条件经 safeReply 转义（唯一 HTML 防线不被绕过）', async () => {
    const h = make({ gateway: makeGateway(true, '<script>alert(1)</script>') });
    await h.useCase.send('你好');
    expect(h.history.addMessage).toHaveBeenNthCalledWith(2, {
      role: 'assistant', content: '&lt;script&gt;alert(1)&lt;/script&gt;',
    });
  });

  it('trace / tool 观察绝不写进历史', async () => {
    const gw = makeGateway();
    gw.execute
      .mockResolvedValueOnce({
        text: '', truncated: false,
        toolCalls: [{ id: 'c1', name: 'plugin_list', arguments: '{}' }],
      } as ModelResult)
      .mockResolvedValueOnce({ text: '列好了', truncated: false } as ModelResult);
    const h = make({ roleId: 'plugin', kit: makePluginKit(), gateway: gw });
    await h.useCase.send('看看有哪些插件');
    expect(h.history.addMessage).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(h.history.addMessage.mock.calls)).not.toContain('当前没有任何插件');
    expect(JSON.stringify(h.history.addMessage.mock.calls)).not.toContain('tool_calls');
  });

  it('插件工具集的 maxTurns 透传给 loop', async () => {
    const gw = makeGateway();
    // 每轮都调工具，用尽后 exhausted 回复仍要正常渲染
    gw.execute.mockResolvedValue({
      text: '', truncated: false,
      toolCalls: [{ id: 'c', name: 'plugin_list', arguments: '{}' }],
    } as ModelResult);
    const kit = makePluginKit({ maxTurns: 2 });
    const h = make({ roleId: 'plugin', kit, gateway: gw });
    await h.useCase.send('循环');
    expect(gw.execute).toHaveBeenCalledTimes(2);
  });
});

describe('ChatUseCase.send — 过程块懒建与兜底（统一 loop 版）', () => {
  it('beginPluginTrace 返回 false → 结束后一次性全量渲染，且只渲染一次', async () => {
    const renderer = makeRenderer();
    renderer.beginPluginTrace.mockReturnValue(false);
    const gw = makeGateway();
    gw.execute
      .mockResolvedValueOnce({
        text: '', truncated: false,
        toolCalls: [{ id: 'c1', name: 'plugin_list', arguments: '{}' }],
      } as ModelResult)
      .mockResolvedValueOnce({ text: '好', truncated: false } as ModelResult);
    const h = make({ roleId: 'plugin', kit: makePluginKit(), gateway: gw, renderer });
    await h.useCase.send('列插件');
    expect(renderer.beginPluginTrace).toHaveBeenCalledTimes(1);
    expect(renderer.appendPluginTraceStep).not.toHaveBeenCalled();
    expect(renderer.finishPluginTrace).not.toHaveBeenCalled();
    expect(renderer.renderPluginTrace).toHaveBeenCalledTimes(1);
    const [trace, title] = renderer.renderPluginTrace.mock.calls[0];
    expect(title).toContain('插件开发过程');
    expect((trace as { phase: string }[]).some((s) => s.phase === 'observe')).toBe(true);
  });

  it('渲染器没有实时方法（旧实现）→ 全量渲染兜底', async () => {
    const bare = {
      renderMessage: vi.fn().mockResolvedValue(undefined),
      clearMessages: vi.fn(), showTyping: vi.fn(), hideTyping: vi.fn(), showCountdownJump: vi.fn(),
      renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMessageRenderer & { renderPluginTrace: ReturnType<typeof vi.fn> };
    const gw = makeGateway();
    gw.execute
      .mockResolvedValueOnce({
        text: '', truncated: false,
        toolCalls: [{ id: 'c1', name: 'plugin_list', arguments: '{}' }],
      } as ModelResult)
      .mockResolvedValueOnce({ text: '好', truncated: false } as ModelResult);
    await new ChatUseCase(
      gw, makeHistory(), bare, makePluginKit(), role('plugin'),
    ).send('列插件');
    expect(bare.renderPluginTrace).toHaveBeenCalledTimes(1);
  });

  it('工具执行抛异常也不让主回复崩掉，过程块正常收尾', async () => {
    const kit = makePluginKit({
      executors: { plugin_list: async () => { throw new Error('炸了'); } },
    });
    const gw = makeGateway();
    gw.execute
      .mockResolvedValueOnce({
        text: '', truncated: false,
        toolCalls: [{ id: 'c1', name: 'plugin_list', arguments: '{}' }],
      } as ModelResult)
      .mockResolvedValueOnce({ text: '仍给出回复', truncated: false } as ModelResult);
    const h = make({ roleId: 'plugin', kit, gateway: gw });
    await h.useCase.send('列插件');
    expect(h.history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '仍给出回复' });
    expect(h.renderer.finishPluginTrace).toHaveBeenCalledWith(false);
  });

  it('过程渲染抛异常也不影响主回复', async () => {
    const renderer = makeRenderer();
    renderer.renderPluginTrace.mockRejectedValue(new Error('渲染炸了'));
    const h = make({ renderer });
    await h.useCase.send('你好');
    expect(h.history.addMessage).toHaveBeenCalledTimes(2);
  });
});
