/**
 * ChatUseCase 测试 —— 角色驱动版
 *
 * 分流依据不再是「猜这句话的措辞」，而是用户显式选定的模型角色：
 * - 不传 roleProvider（或返回 'chat'）→ 纯聊天，永不进 Agent
 * - 返回 'plugin' → 所有消息进 Agent，并展示实时过程日志
 *
 * 因此旧文件里那二十多条「白名单措辞 / 承接上文短句」用例全部删除，
 * 换成少量「角色决定一切」的回归用例。这本身就是这次重构要的「轻」。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ChatUseCase, isSlashCommand,
  SLASH_COMMAND_HINT, NOT_READY_HINT, AGENT_UNAVAILABLE_HINT,
} from '../ChatUseCase';
import { CONVERSATION_SYSTEM_PROMPT } from '../ConversationPrompt';
import { visibleDebugSteps, isDebugTraceStep } from '../PluginTraceVisibility';
import type { ChatRoleId } from '../ChatRole';
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

/** 造一个 Agent 壳；不传时表示插件系统未装配 */
function makeAgent(reply = '好的') {
  return {
    turn: vi.fn().mockResolvedValue({ reply, acted: false, attempts: 0 }),
    safeReply: vi.fn((t: string) => t),
  };
}

/** 角色 provider：默认闲聊 */
function role(id: ChatRoleId = 'chat'): () => ChatRoleId {
  return () => id;
}

/** 构造用例：参数化角色，避免每个用例重复四五个实参 */
function make(opts: {
  roleId?: ChatRoleId;
  agent?: ReturnType<typeof makeAgent> | undefined;
  gateway?: ReturnType<typeof makeGateway>;
  history?: ReturnType<typeof makeHistory>;
  renderer?: ReturnType<typeof makeRenderer>;
}) {
  const renderer = opts.renderer ?? makeRenderer();
  const history = opts.history ?? makeHistory();
  const gateway = opts.gateway ?? makeGateway();
  const agent = opts.agent;
  const useCase = new ChatUseCase(gateway, history, renderer, agent, role(opts.roleId ?? 'chat'));
  return { renderer, history, gateway, agent, useCase };
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

  it('正常路径：user 与 assistant 成对写入历史，jsonMode=false', async () => {
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

describe('ChatUseCase.send — 角色决定一切（核心回归）', () => {
  it('闲聊角色：即使装了 Agent、即使说「启用/写个规则」，也永不进智能体', async () => {
    for (const text of ['启用', '写个规则', '查看插件', '你好']) {
      const h = make({ roleId: 'chat', agent: makeAgent('插件回复') });
      await h.useCase.send(text);
      expect(h.agent!.turn, text).not.toHaveBeenCalled();
      expect(h.gateway.execute, text).toHaveBeenCalledTimes(1);
      expect(h.renderer.beginPluginTrace, text).not.toHaveBeenCalled();
      expect(h.renderer.renderPluginTrace, text).not.toHaveBeenCalled();
    }
  });

  it('插件角色：所有消息都进 Agent，包括「启用」「你好」这类纯文字（不再猜措辞）', async () => {
    for (const text of ['启用', '你好', '写个规则', '是的，启用吧']) {
      const h = make({ roleId: 'plugin', agent: makeAgent('已启用') });
      await h.useCase.send(text);
      expect(h.agent!.turn, text).toHaveBeenCalledTimes(1);
      expect(h.gateway.execute, text).not.toHaveBeenCalled(); // 由 Agent 内部调网关
    }
  });

  it('插件角色下「启用 / 查看插件列表」不显示插件调试过程（本次回归的核心）', async () => {
    // Agent 对这类动作只推 decision / observe / final，没有任何 codegen 步骤。
    // 过程块必须**完全不出现**（连空壳都不建），而不是建了再折叠。
    for (const text of ['启用', '看一下插件列表', '停用', '删除这个插件', '查看源码']) {
      const agent = makeAgent('已启用');
      agent.turn = vi.fn(async (req: { onTrace?: (s: { source: 'agent' | 'codegen'; attempt: number; phase: string; ok: boolean; detail: string }) => void }) => {
        req.onTrace?.({ source: 'agent', attempt: 1, phase: 'decision', ok: true, detail: '第 1 次决策：调用模型' });
        req.onTrace?.({ source: 'agent', attempt: 1, phase: 'decision', ok: true, detail: '第 1 次决策：动作 plugin.toggle' });
        req.onTrace?.({ source: 'agent', attempt: 1, phase: 'observe', ok: true, detail: '插件已启用（已写入存储）' });
        req.onTrace?.({ source: 'agent', attempt: 1, phase: 'final', ok: true, detail: '收尾' });
        return { reply: '已启用', acted: true, attempts: 1, trace: [] };
      });
      const h = make({ roleId: 'plugin', agent });
      await h.useCase.send(text);
      expect(h.renderer.beginPluginTrace, text).not.toHaveBeenCalled();
      expect(h.renderer.appendPluginTraceStep, text).not.toHaveBeenCalled();
      expect(h.renderer.renderPluginTrace, text).not.toHaveBeenCalled();
      expect(h.renderer.finishPluginTrace, text).not.toHaveBeenCalled();
    }
  });

  it('不传 roleProvider 时默认闲聊（向后兼容旧调用方）', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const gateway = makeGateway();
    const agent = makeAgent();
    await new ChatUseCase(gateway, history, renderer, agent).send('写个规则');
    expect(agent.turn).not.toHaveBeenCalled();
    expect(gateway.execute).toHaveBeenCalledTimes(1);
  });

  it('角色可在会话中途切换：同一实例先闲聊后插件，两条路径都走对', async () => {
    const renderer = makeRenderer();
    const history = makeHistory();
    const gateway = makeGateway();
    const agent = makeAgent('已启用');
    let current: ChatRoleId = 'chat';
    const useCase = new ChatUseCase(gateway, history, renderer, agent, () => current);

    await useCase.send('启用'); // 闲聊：不执行
    expect(agent.turn).not.toHaveBeenCalled();
    expect(gateway.execute).toHaveBeenCalledTimes(1);

    current = 'plugin';
    await useCase.send('启用'); // 插件角色：真正进 Agent
    expect(agent.turn).toHaveBeenCalledTimes(1);
    expect(gateway.execute).toHaveBeenCalledTimes(1); // 没有再调普通网关
  });

  it('选了插件角色但插件系统没装配 → 明确提示，不静默降级成闲聊', async () => {
    const h = make({ roleId: 'plugin', agent: undefined });
    await h.useCase.send('启用');
    expect(h.gateway.execute).not.toHaveBeenCalled();
    expect(h.renderer.renderMessage).toHaveBeenLastCalledWith(
      AGENT_UNAVAILABLE_HINT, false, null, null, undefined, undefined, false,
    );
    // 用户消息仍落盘（确实发了），但没有 assistant 假回复
    expect(h.history.addMessage).toHaveBeenCalledTimes(1);
  });

  it('闲聊角色的回复也经 safeReply 转义（唯一 HTML 防线不被绕过）', async () => {
    const agent = makeAgent();
    agent.safeReply = vi.fn((t: string) => t.replace(/</g, '&lt;'));
    const h = make({ roleId: 'chat', agent, gateway: makeGateway(true, '<script>x</script>') });
    await h.useCase.send('你好');
    expect(agent.safeReply).toHaveBeenCalledWith('<script>x</script>');
    expect(h.history.addMessage).toHaveBeenNthCalledWith(2, {
      // mock 的 replace(/</g, ...) 是全局替换，两个 < 都会被转义
      role: 'assistant', content: '&lt;script>x&lt;/script>',
    });
  });

  it('插件角色：回复经 safeReply 转义，且过程日志绝不写进历史', async () => {
    const trace = [
      { source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: true, detail: '试算通过' },
    ];
    const agent = makeAgent('已生成插件候选');
    agent.turn = vi.fn().mockResolvedValue({ reply: '已生成插件候选', acted: true, attempts: 1, trace });
    agent.safeReply = vi.fn((t: string) => t.replace(/</g, '&lt;'));
    const h = make({ roleId: 'plugin', agent });
    await h.useCase.send('写个规则');
    expect(agent.safeReply).toHaveBeenCalledWith('已生成插件候选');
    expect(h.history.addMessage).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(h.history.addMessage.mock.calls)).not.toContain('试算通过');
  });
});

describe('ChatUseCase.send — 插件角色的实时过程日志', () => {
  it('过程块懒建：turn 期间没有调试步骤时不点亮，第一个 codegen 步骤到达才建', async () => {
    let resolveTurn: ((v: { reply: string; acted: boolean; attempts: number }) => void) | undefined;
    const pending = new Promise<{ reply: string; acted: boolean; attempts: number }>((r) => { resolveTurn = r; });
    let pushStep: ((s: { source: 'agent' | 'codegen'; attempt: number; phase: string; ok: boolean; detail: string }) => void) | undefined;
    const agent = makeAgent();
    agent.turn = vi.fn((req: { onTrace?: (s: { source: 'agent' | 'codegen'; attempt: number; phase: string; ok: boolean; detail: string }) => void }) => {
      pushStep = req.onTrace;
      return pending;
    });
    const h = make({ roleId: 'plugin', agent });
    const sendPromise = h.useCase.send('写个规则');
    // send() 里先 await 了渲染用户气泡 / 写历史 / runAgent 内部链，
    // agent.turn 在若干微任务之后才调。轮询等 onTrace 被赋值（有上限，不死等）。
    for (let i = 0; i < 50 && !pushStep; i++) await Promise.resolve();
    expect(pushStep).toBeTypeOf('function');

    // 思考期间只有内部编排步骤 → 不该有任何过程块
    pushStep!({ source: 'agent', attempt: 1, phase: 'decision', ok: true, detail: '第 1 次决策：调用模型' });
    expect(h.renderer.beginPluginTrace).not.toHaveBeenCalled();

    // 第一个实质调试步骤到达 → 此刻才点亮
    pushStep!({ source: 'codegen', attempt: 1, phase: 'llm', ok: true, detail: '正在调用模型' });
    expect(h.renderer.beginPluginTrace).toHaveBeenCalledTimes(1);
    expect(h.renderer.appendPluginTraceStep).toHaveBeenCalledTimes(1);

    resolveTurn!({ reply: '已生成', acted: true, attempts: 1 });
    await sendPromise;
    expect(h.renderer.finishPluginTrace).toHaveBeenCalledTimes(1);
  });

  it('逐步推 trace → 逐步 append，只收实质调试步骤', async () => {
    const steps = [
      { source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '第 1 次决策：调用模型' },
      { source: 'codegen' as const, attempt: 1, phase: 'llm', ok: true, detail: '正在调用模型', code: 'function rank(p){return p}' },
      { source: 'codegen' as const, attempt: 1, phase: 'validate', ok: true, detail: '校验通过' },
      { source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: true, detail: '试算通过' },
      { source: 'agent' as const, attempt: 1, phase: 'final', ok: true, detail: '收尾' },
    ];
    const agent = makeAgent('已生成');
    agent.turn = vi.fn(async (req: { onTrace?: (s: typeof steps[number]) => void }) => {
      for (const s of steps) req.onTrace?.(s);
      return { reply: '已生成', acted: true, attempts: 1, trace: steps };
    });
    const h = make({ roleId: 'plugin', agent });
    await h.useCase.send('写个规则');
    expect(h.renderer.appendPluginTraceStep).toHaveBeenCalledTimes(3); // decision/final 被过滤
    expect(h.renderer.appendPluginTraceStep).toHaveBeenNthCalledWith(1, steps[1]);
    expect(h.renderer.finishPluginTrace).toHaveBeenCalledWith(true);
    expect(h.renderer.renderPluginTrace).not.toHaveBeenCalled();
  });

  it('末步失败 → finishPluginTrace(false)', async () => {
    const agent = makeAgent('失败');
    agent.turn = vi.fn(async (req: { onTrace?: (s: { source: 'agent' | 'codegen'; attempt: number; phase: string; ok: boolean; detail: string }) => void }) => {
      req.onTrace?.({ source: 'codegen', attempt: 1, phase: 'sandbox', ok: false, detail: '试算失败' });
      return { reply: '失败', acted: false, attempts: 0, trace: [] };
    });
    const h = make({ roleId: 'plugin', agent });
    await h.useCase.send('写个规则');
    expect(h.renderer.finishPluginTrace).toHaveBeenCalledWith(false);
  });

  it('Agent 抛错也收尾，过程块不挂「进行中」', async () => {
    const agent = makeAgent();
    agent.turn = vi.fn(async (req: { onTrace?: (s: { source: 'agent' | 'codegen'; attempt: number; phase: string; ok: boolean; detail: string }) => void }) => {
      req.onTrace?.({ source: 'codegen', attempt: 1, phase: 'sandbox', ok: true, detail: '沙箱试算通过' });
      throw new Error('Agent 炸了');
    });
    const h = make({ roleId: 'plugin', agent });
    await h.useCase.send('写个规则');
    expect(h.renderer.finishPluginTrace).toHaveBeenCalledTimes(1);
    expect(h.renderer.finishPluginTrace).toHaveBeenCalledWith(false);
    expect(h.history.addMessage).toHaveBeenCalledTimes(1);
  });

  it('beginPluginTrace 返回 false（不支持实时）→ 回退全量渲染，且不逐步重试', async () => {
    const renderer = makeRenderer();
    renderer.beginPluginTrace.mockReturnValue(false);
    const trace = [
      { source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: true, detail: '沙箱试算通过' },
      { source: 'codegen' as const, attempt: 1, phase: 'validate', ok: true, detail: '校验通过' },
    ];
    const agent = makeAgent('好');
    agent.turn = vi.fn(async (req: { onTrace?: (s: typeof trace[number]) => void }) => {
      for (const s of trace) req.onTrace?.(s); // 触发懒建，但 begin 返回 false
      return { reply: '好', acted: false, attempts: 0, trace };
    });
    const h = make({ roleId: 'plugin', agent, renderer });
    await h.useCase.send('写个规则');
    expect(renderer.beginPluginTrace).toHaveBeenCalledTimes(1); // 只试一次，不逐步重试
    expect(renderer.appendPluginTraceStep).not.toHaveBeenCalled();
    expect(renderer.finishPluginTrace).not.toHaveBeenCalled();
    expect(renderer.renderPluginTrace).toHaveBeenCalledWith(trace);
  });

  it('渲染器没有实时方法（旧实现）→ 全量渲染兜底', async () => {
    const bare = {
      renderMessage: vi.fn().mockResolvedValue(undefined),
      clearMessages: vi.fn(), showTyping: vi.fn(), hideTyping: vi.fn(), showCountdownJump: vi.fn(),
      renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMessageRenderer & { renderPluginTrace: ReturnType<typeof vi.fn> };
    const trace = [{ source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: true, detail: '试算通过' }];
    const agent = makeAgent('好');
    agent.turn = vi.fn().mockResolvedValue({ reply: '好', acted: false, attempts: 0, trace });
    await new ChatUseCase(makeGateway(), makeHistory(), bare, agent, role('plugin')).send('写个规则');
    expect(bare.renderPluginTrace).toHaveBeenCalledWith(trace);
  });

  it('全量兜底也过滤掉非调试步骤（decision / observe / final）', async () => {
    const bare = {
      renderMessage: vi.fn().mockResolvedValue(undefined),
      clearMessages: vi.fn(), showTyping: vi.fn(), hideTyping: vi.fn(), showCountdownJump: vi.fn(),
      renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMessageRenderer & { renderPluginTrace: ReturnType<typeof vi.fn> };
    const decision = { source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '第 1 次决策' };
    const sandbox = { source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: true, detail: '试算通过' };
    const agent = makeAgent('好');
    agent.turn = vi.fn().mockResolvedValue({ reply: '好', acted: false, attempts: 0, trace: [decision, sandbox] });
    await new ChatUseCase(makeGateway(), makeHistory(), bare, agent, role('plugin')).send('写个规则');
    expect(bare.renderPluginTrace).toHaveBeenCalledWith([sandbox]);
  });

  it('一条调试步骤都没有时不渲染过程块', async () => {
    const bare = {
      renderMessage: vi.fn().mockResolvedValue(undefined),
      clearMessages: vi.fn(), showTyping: vi.fn(), hideTyping: vi.fn(), showCountdownJump: vi.fn(),
      renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMessageRenderer & { renderPluginTrace: ReturnType<typeof vi.fn> };
    const agent = makeAgent('好');
    agent.turn = vi.fn().mockResolvedValue({
      reply: '好', acted: false, attempts: 0,
      trace: [{ source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '第 1 次决策' }],
    });
    await new ChatUseCase(makeGateway(), makeHistory(), bare, agent, role('plugin')).send('你好');
    expect(bare.renderPluginTrace).not.toHaveBeenCalled();
  });

  it('闲聊角色下过程渲染抛异常也不影响主回复', async () => {
    const renderer = makeRenderer();
    renderer.renderPluginTrace.mockRejectedValue(new Error('渲染炸了'));
    const h = make({ roleId: 'chat', agent: makeAgent(), renderer });
    await h.useCase.send('你好');
    expect(h.history.addMessage).toHaveBeenCalledTimes(2);
  });
});

describe('PluginTraceVisibility — 步骤过滤口径（两个角色共用）', () => {
  it('visibleDebugSteps / isDebugTraceStep 只放行代码与调试步骤', () => {
    const decision = { source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '决策' };
    const observe = { source: 'agent' as const, attempt: 1, phase: 'observe', ok: true, detail: '观测' };
    const final = { source: 'agent' as const, attempt: 1, phase: 'final', ok: true, detail: '收尾' };
    const llm = { source: 'codegen' as const, attempt: 1, phase: 'llm', ok: true, detail: '提取源码', code: 'function rank(p){return p}' };
    const sandbox = { source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: true, detail: '试算通过' };
    const validate = { source: 'agent' as const, attempt: 1, phase: 'validate', ok: false, detail: '候选代码校验失败' };
    const withCode = { source: 'agent' as const, attempt: 1, phase: 'observe', ok: true, detail: '回喂源码', code: 'function rank(p){return p}' };

    expect(isDebugTraceStep(decision)).toBe(false);
    expect(isDebugTraceStep(observe)).toBe(false);
    expect(isDebugTraceStep(final)).toBe(false);
    expect(isDebugTraceStep(llm)).toBe(true);
    expect(isDebugTraceStep(sandbox)).toBe(true);
    expect(isDebugTraceStep(validate)).toBe(true);
    expect(isDebugTraceStep(withCode)).toBe(true);
    expect(visibleDebugSteps([decision, observe, llm, validate, sandbox, final, withCode]))
      .toEqual([llm, validate, sandbox, withCode]);
  });
});
