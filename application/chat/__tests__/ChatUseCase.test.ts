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

  it('实时链路：agent 逐步推 trace → 逐步 append，不再等全部干完才列', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const steps = [
      { source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '第 1 次决策' },
      { source: 'codegen' as const, attempt: 1, phase: 'llm', ok: true, detail: '模型已返回', code: 'function rank(p){return p}' },
      { source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: true, detail: '试算通过' },
    ];
    const agent = {
      // 模拟真实 Agent：在 turn 执行过程中同步调用第二参数 sink
      turn: vi.fn(async (req: { onTrace?: (s: typeof steps[number]) => void }) => {
        const onTrace = req.onTrace;
        for (const s of steps) onTrace?.(s);
        return { reply: '已生成插件候选', acted: true, attempts: 1, trace: steps };
      }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('写个规则');

    // turn 通过 req.onTrace 收到 sink
    expect(agent.turn.mock.calls[0]![0].onTrace).toBeTypeOf('function');
    // 懒开启：收到第一步才 begin
    expect(renderer.beginPluginTrace).toHaveBeenCalledTimes(1);
    // 逐步 append，共 3 步
    expect(renderer.appendPluginTraceStep).toHaveBeenCalledTimes(3);
    expect(renderer.appendPluginTraceStep).toHaveBeenNthCalledWith(1, steps[0]);
    expect(renderer.appendPluginTraceStep).toHaveBeenNthCalledWith(3, steps[2]);
    // 收尾一次；实时模式下不再全量重渲染（避免重复）
    expect(renderer.finishPluginTrace).toHaveBeenCalledTimes(1);
    expect(renderer.finishPluginTrace).toHaveBeenCalledWith(true);
    expect(renderer.renderPluginTrace).not.toHaveBeenCalled();
    // 过程日志绝不写历史
    expect(history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '已生成插件候选' });
    expect(JSON.stringify(history.addMessage.mock.calls)).not.toContain('试算通过');
  });

  it('实时链路：纯闲聊不发任何步骤 → 不开过程块、不 append、不收尾', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const agent = {
      turn: vi.fn().mockResolvedValue({ reply: '好的', acted: false, attempts: 0 }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('你好');
    expect(renderer.beginPluginTrace).not.toHaveBeenCalled();
    expect(renderer.appendPluginTraceStep).not.toHaveBeenCalled();
    expect(renderer.finishPluginTrace).not.toHaveBeenCalled();
    expect(renderer.renderPluginTrace).not.toHaveBeenCalled();
  });

  it('实时链路：末步失败 → finishPluginTrace(false)', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const agent = {
      turn: vi.fn(async (req: { onTrace?: (s: { source: 'agent'; attempt: number; phase: string; ok: boolean; detail: string }) => void }) => {
        req.onTrace?.({ source: 'agent', attempt: 1, phase: 'decision', ok: false, detail: '模型调用失败' });
        return { reply: '模型调用失败', acted: false, attempts: 0, trace: [] };
      }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('你好');
    expect(renderer.finishPluginTrace).toHaveBeenCalledWith(false);
  });

  it('实时链路：Agent 抛错也收尾，过程块不挂「进行中」', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const agent = {
      turn: vi.fn(async (req: { onTrace?: (s: { source: 'agent'; attempt: number; phase: string; ok: boolean; detail: string }) => void }) => {
        req.onTrace?.({ source: 'agent', attempt: 1, phase: 'decision', ok: true, detail: '调用模型' });
        throw new Error('Agent 炸了');
      }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('你好');
    expect(renderer.appendPluginTraceStep).toHaveBeenCalledTimes(1);
    expect(renderer.finishPluginTrace).toHaveBeenCalledTimes(1);
    expect(renderer.finishPluginTrace).toHaveBeenCalledWith(false);
  });

  it('beginPluginTrace 返回 false（渲染器不支持实时）→ 回退全量渲染', async () => {
    const renderer = makeRenderer();
    renderer.beginPluginTrace.mockReturnValue(false);
    const history = makeHistory();
    const trace = [{ source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '调用模型' }];
    const agent = {
      turn: vi.fn().mockResolvedValue({ reply: '好', acted: false, attempts: 0, trace }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('你好');
    expect(renderer.appendPluginTraceStep).not.toHaveBeenCalled();
    expect(renderer.finishPluginTrace).not.toHaveBeenCalled();
    expect(renderer.renderPluginTrace).toHaveBeenCalledWith(trace);
  });

  it('渲染器没有实时方法（旧实现）→ 全量渲染兜底', async () => {
    const renderer = {
      renderMessage: vi.fn().mockResolvedValue(undefined),
      clearMessages: vi.fn(), showTyping: vi.fn(), hideTyping: vi.fn(), showCountdownJump: vi.fn(),
      renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMessageRenderer & { renderPluginTrace: ReturnType<typeof vi.fn> };
    const history = makeHistory();
    const trace = [{ source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '调用模型' }];
    const agent = {
      turn: vi.fn().mockResolvedValue({ reply: '好', acted: false, attempts: 0, trace }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('你好');
    expect(renderer.renderPluginTrace).toHaveBeenCalledWith(trace);
  });

  it('实时过程渲染抛异常不影响主回复', async () => {
    const renderer = makeRenderer();
    renderer.appendPluginTraceStep.mockImplementation(() => { throw new Error('DOM 炸了'); });
    const history = makeHistory();
    const agent = {
      turn: vi.fn(async (req: { onTrace?: (s: { source: 'agent'; attempt: number; phase: string; ok: boolean; detail: string }) => void }) => {
        req.onTrace?.({ source: 'agent', attempt: 1, phase: 'decision', ok: true, detail: '调用模型' });
        return { reply: '主回复', acted: false, attempts: 0, trace: [] };
      }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('你好');
    expect(history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '主回复' });
    expect(renderer.finishPluginTrace).toHaveBeenCalled();
  });

  it('Agent 路径把 trace 交给渲染器，且过程日志绝不写进历史', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const trace = [
      { source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '第 1 次决策' },
      { source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: true, detail: '试算通过', code: 'function rank(p){return p}' },
    ];
    const agent = {
      turn: vi.fn().mockResolvedValue({ reply: '已生成插件候选', acted: true, attempts: 1, trace }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('写个规则');

    expect(renderer.renderPluginTrace).toHaveBeenCalledTimes(1);
    expect(renderer.renderPluginTrace).toHaveBeenCalledWith(trace);
    // 历史里只有干净的 user/assistant 文本
    expect(history.addMessage).toHaveBeenCalledTimes(2);
    expect(history.addMessage).toHaveBeenNthCalledWith(1, { role: 'user', content: '写个规则' });
    expect(history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '已生成插件候选' });
    expect(JSON.stringify(history.addMessage.mock.calls)).not.toContain('试算通过');
    // 过程日志在主回复之前渲染
    const traceOrder = renderer.renderPluginTrace.mock.invocationCallOrder[0];
    const replyCall = renderer.renderMessage.mock.calls.findIndex(
      (c: unknown[]) => c[0] === '已生成插件候选',
    );
    expect(replyCall).toBeGreaterThanOrEqual(0);
    expect(traceOrder).toBeLessThan(renderer.renderMessage.mock.invocationCallOrder[replyCall]!);
  });

  it('Agent 返回空/无 trace 时不调用渲染器（可选方法兼容）', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const agent = {
      turn: vi.fn().mockResolvedValue({ reply: '好的', acted: false, attempts: 0 }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('你好');
    expect(renderer.renderPluginTrace).not.toHaveBeenCalled();
    expect(history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '好的' });
  });

  it('渲染器未实现 renderPluginTrace 时纯聊天/智能体都不报错', async () => {
    const bare = {
      renderMessage: vi.fn().mockResolvedValue(undefined),
      clearMessages: vi.fn(), showTyping: vi.fn(), hideTyping: vi.fn(), showCountdownJump: vi.fn(),
    } as unknown as IMessageRenderer;
    const history = makeHistory();
    const agent = {
      turn: vi.fn().mockResolvedValue({
        reply: '好', acted: false, attempts: 0,
        trace: [{ source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '调用模型' }],
      }),
      safeReply: vi.fn((t: string) => t),
    };
    await expect(new ChatUseCase(makeGateway(), history, bare, agent).send('你好')).resolves.toBeUndefined();
    expect(history.addMessage).toHaveBeenCalledTimes(2);
  });

  it('过程日志渲染失败不影响主回复（纯展示功能隔离）', async () => {
    const renderer = makeRenderer();
    renderer.renderPluginTrace.mockRejectedValue(new Error('DOM 炸了'));
    const history = makeHistory();
    const agent = {
      turn: vi.fn().mockResolvedValue({
        reply: '主回复', acted: true, attempts: 1,
        trace: [{ source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '调用模型' }],
      }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('写个规则');
    expect(history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '主回复' });
    expect(renderer.renderMessage).toHaveBeenLastCalledWith(
      '主回复', false, null, null, undefined, undefined, true,
    );
  });

  it('未装配 Agent 的纯聊天路径不渲染过程日志', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    await new ChatUseCase(makeGateway(), history, renderer).send('你好');
    expect(renderer.renderPluginTrace).not.toHaveBeenCalled();
  });

  it('装配 Agent 后走智能体路径，回复经 safeReply 处理', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const gateway = makeGateway();
    const agent = {
      turn: vi.fn().mockResolvedValue({ reply: '已生成插件候选', acted: true, attempts: 1 }),
      safeReply: vi.fn((t: string) => t.replace(/</g, '&lt;')),
    };
    await new ChatUseCase(gateway, history, renderer, agent).send('写个排名规则');
    expect(agent.turn).toHaveBeenCalledTimes(1);
    expect(gateway.execute).not.toHaveBeenCalled(); // 由 Agent 内部调网关
    expect(agent.safeReply).toHaveBeenCalledWith('已生成插件候选');
    expect(history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '已生成插件候选' });
  });

  it('Agent 路径把会话历史作为聊天上下文传入，但当前句由 text 单独给', async () => {
    const renderer = makeRenderer();
    const history = makeHistory([
      { role: 'user', content: '之前说过' },
      { role: 'assistant', content: '嗯' },
    ]);
    const agent = {
      turn: vi.fn().mockResolvedValue({ reply: '好的', acted: false, attempts: 0 }),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('继续');
    const req = agent.turn.mock.calls[0]![0];
    expect(req.text).toBe('继续');
    expect(req.history.map((m: { content: string }) => m.content)).toContain('之前说过');
    // 当前句不在 history 里重复
    expect(req.history.map((m: { content: string }) => m.content)).not.toContain('继续');
  });

  it('Agent 抛错时只渲染错误，不把错误写进历史', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const agent = {
      turn: vi.fn().mockRejectedValue(new Error('Agent 炸了')),
      safeReply: vi.fn((t: string) => t),
    };
    await new ChatUseCase(makeGateway(), history, renderer, agent).send('你好');
    expect(renderer.hideTyping).toHaveBeenCalled();
    expect(history.addMessage).toHaveBeenCalledTimes(1);
    expect(renderer.renderMessage).toHaveBeenLastCalledWith(
      '❌ 对话失败：Agent 炸了', false, null, null, undefined, undefined, false,
    );
  });

  it('未装配 Agent 时保持纯聊天（既有行为不回归）', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const gateway = makeGateway(true, '两人互有胜负');
    await new ChatUseCase(gateway, history, renderer).send('柯洁和申真谞谁厉害');
    const req = gateway.execute.mock.calls[0]![0];
    expect(req.task).toBe('chat.reply');
    expect(req.options.jsonMode).toBe(false);
    expect(history.addMessage).toHaveBeenNthCalledWith(2, { role: 'assistant', content: '两人互有胜负' });
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
