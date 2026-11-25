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
import { CONVERSATION_SYSTEM_PROMPT, CONTEXT_LIMITS } from '../ConversationPrompt';
import { DEFAULT_PLUGIN_MAX_ATTEMPTS } from '../../plugin/PluginConfig';
import type { ToolKit } from '../ToolLoop';
import type { ChatRoleId } from '../ChatRole';
import type { IModelGateway, ModelResult } from '../../model/IModelGateway';
import type { ChatHistoryManager } from '../../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../../assistant/IMessageRenderer';
import { createSkillRegistry } from '../../skill/SkillRegistry';
import type { SkillRecipe } from '../../skill/SkillTypes';
import { createBasicPrimitives } from '../../skill/primitives/BasicPrimitives';
import type { SkillDevKit } from '../../skill/dev/SkillDevTools';

/** 测试用的本地配方：等价于一条「已安装」的做题技能（安装制下不再有内置常量） */
const TEST_SKILLS: SkillRecipe[] = [{
  schemaVersion: 1,
  id: 'puzzle.tsumego',
  version: 4,
  name: '做题练习',
  summary: '用户想做题时由宿主生成带参数的做题页链接。',
  primitives: ['navigate_to'],
  prompt: '调用 navigate_to 生成做题页链接；链接由宿主按钮呈现，回复里不要写网址。',
}];

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
    getCurrentSession: vi.fn(() => ({ sessionId: 's1', messages: store })),
    addMessage: vi.fn(async (m: { role: 'user' | 'assistant'; content: string }) => { store.push(m); }),
    setCurrentSessionTitle: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatHistoryManager & {
    getMessages: ReturnType<typeof vi.fn>;
    getCurrentSession: ReturnType<typeof vi.fn>;
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
    const h = make({ roleId: 'dev', kit, gateway: gw });
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
    const h = make({ roleId: 'dev', kit: makePluginKit(), gateway: gw });
    await h.useCase.send('看看有哪些插件');
    expect(h.renderer.beginPluginTrace).toHaveBeenCalledWith(expect.stringContaining('开发过程'));
    const appended = h.renderer.appendPluginTraceStep.mock.calls.map((c) => c[0]);
    expect(appended.some((s: { source: string; phase: string }) =>
      s.source === 'plugin' && s.phase === 'observe')).toBe(true);
    expect(h.renderer.finishPluginTrace).toHaveBeenCalledWith(true);
  });

  it('两个角色复用同一 loop：无工具调用时都不建过程块（懒建）', async () => {
    for (const roleId of ['chat', 'dev'] as const) {
      const gw = makeGateway(true, '纯文本回复');
      const h = make({ roleId, ...(roleId === 'dev' ? { kit: makePluginKit() } : {}), gateway: gw });
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
    current = 'dev';
    await useCase.send('你好'); // 插件角色：动态 system
    const req = gateway.execute.mock.calls[1]![0];
    expect(req.messages[0]).toEqual({ role: 'system', content: '你是插件开发智能体' });
  });

  it('开发角色 + 插件系统没装配：不再整轮拦死，降级成 chat 超集仍能进 tool loop', async () => {
    const gw = makeGateway();
    const h = make({ roleId: 'dev', kit: undefined, gateway: gw, webTools: true });
    await h.useCase.send('验收刚写的 workflow 技能');
    expect(h.gateway.execute).toHaveBeenCalled(); // 关键回归：网关零调用曾是真 bug
    expect(h.renderer.renderMessage).not.toHaveBeenCalledWith(
      AGENT_UNAVAILABLE_HINT, false, null, null, undefined, undefined, false,
    );
    expect(h.history.addMessage).toHaveBeenCalled(); // 用户消息 + 助手回复都落盘
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
    const h = make({ roleId: 'dev', kit: makePluginKit(), gateway: gw });
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
    const h = make({ roleId: 'dev', kit, gateway: gw });
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
    const h = make({ roleId: 'dev', kit: makePluginKit(), gateway: gw, renderer });
    await h.useCase.send('列插件');
    expect(renderer.beginPluginTrace).toHaveBeenCalledTimes(1);
    expect(renderer.appendPluginTraceStep).not.toHaveBeenCalled();
    expect(renderer.finishPluginTrace).not.toHaveBeenCalled();
    expect(renderer.renderPluginTrace).toHaveBeenCalledTimes(1);
    const [trace, title] = renderer.renderPluginTrace.mock.calls[0];
    expect(title).toContain('开发过程');
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
      gw, makeHistory(), bare, makePluginKit(), role('dev'),
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
    const h = make({ roleId: 'dev', kit, gateway: gw });
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

/**
 * 会话标题精炼：旁路调用的会话归属与静默降级
 * （接入 2026-11-15：标题由模型概括成短标题，不再硬截 30 字）
 */
describe('ChatUseCase.refineSessionTitle', () => {
  const long = '请帮我详细分析一下柯洁和申真谞最近十盘对局里的布局变化';

  it('长输入走一次 chat.title 请求，成功后把短标题写回当前会话', async () => {
    const gw = makeGateway(true, '柯洁申真谞布局');
    const h = make({ gateway: gw });
    const refined = await h.useCase.refineSessionTitle(long, 's1');
    expect(refined).toBe('柯洁申真谞布局');
    expect(h.history.setCurrentSessionTitle).toHaveBeenCalledWith('柯洁申真谞布局');
    const req = gw.execute.mock.calls[0]![0];
    expect(req.task).toBe('chat.title');
    expect(req.tools).toBeUndefined();
  });

  it('短输入不发请求，返回 null（保留 send() 已写入的兜底标题）', async () => {
    const gw = makeGateway(true, ' whatever');
    const h = make({ gateway: gw });
    expect(await h.useCase.refineSessionTitle('你好', 's1')).toBeNull();
    expect(gw.execute).not.toHaveBeenCalled();
    expect(h.history.setCurrentSessionTitle).not.toHaveBeenCalled();
  });

  it('模型失败时静默降级，不抛、不写标题', async () => {
    const gw = makeGateway(true, '');
    gw.execute.mockRejectedValueOnce(new Error('timeout'));
    const h = make({ gateway: gw });
    expect(await h.useCase.refineSessionTitle(long, 's1')).toBeNull();
    expect(h.history.setCurrentSessionTitle).not.toHaveBeenCalled();
  });

  it('异步期间会话已切换 → 丢弃结果，绝不把旧标题写到新会话', async () => {
    const gw = makeGateway(true, '柯洁申真谞布局');
    const h = make({ gateway: gw });
    // 发起时是 s1；等模型返回时当前会话已变成别的 id
    (h.history as unknown as { getCurrentSession: ReturnType<typeof vi.fn> })
      .getCurrentSession = vi.fn(() => ({ sessionId: 's2', messages: [] }));
    expect(await h.useCase.refineSessionTitle(long, 's1')).toBeNull();
    expect(h.history.setCurrentSessionTitle).not.toHaveBeenCalled();
  });
});


/**
 * 回归（2026-11-16 用户实测）：同一会话第二轮换难度，模型从历史照抄旧链接导致参数错。
 * 根治方式是把链接作为结构化 actionUrl 由宿主直接渲染并落历史，
 * assistant 历史文本里不含任何链接、URL 或 & 实体。
 */
describe('ChatUseCase.send — 做题链接由宿主注入', () => {
  const webDeps = {
    proxyUrl: 'https://api.weiqi.lol', timeoutMs: 60_000,
    fetchImpl: vi.fn() as unknown as typeof fetch,
  };

  function makeSkillUseCase(
    gw: IModelGateway,
    r: ReturnType<typeof makeRenderer>,
    hist: ReturnType<typeof makeHistory>,
  ) {
    const primitives = createSkillRegistry(createBasicPrimitives(webDeps));
    const skills = {
      loadSkills: async () => TEST_SKILLS,
      primitives,
      routeSkills: async (recipes: readonly SkillRecipe[]) => recipes.map((x) => x.id),
    };
    return new ChatUseCase(gw, hist, r, undefined, () => 'chat' as ChatRoleId, webDeps, skills);
  }

  it('工具产出 actionLink → renderMessage 收到 actionUrl/actionText，历史里也只有结构化字段', async () => {
    const gateway = {
      isReady: vi.fn(() => true),
      execute: vi.fn()
        .mockResolvedValueOnce({
          text: '', truncated: false,
          toolCalls: [{ id: 'c1', name: 'navigate_to', arguments: JSON.stringify({
            path: '/puzzle/index.html', label: '做3K官子题',
            query: { type: '官子', difficulty: '3K' },
          }) }],
        })
        .mockResolvedValueOnce({ text: '官子题要点是抢先手收束。', truncated: false }),
    } as unknown as IModelGateway & { execute: ReturnType<typeof vi.fn> };

    const r = makeRenderer();
    const hist = makeHistory();
    await makeSkillUseCase(gateway, r, hist).send('做3K官子题');

    // 渲染：链接走 actionUrl 通道，回复文本里没有链接
    const call = r.renderMessage.mock.calls.find(
      (c: unknown[]) => c[4] !== undefined,
    ) as unknown[] | undefined;
    expect(call).toBeDefined();
    expect(call![4]).toBe('/puzzle/index.html?type=%E5%AE%98%E5%AD%90&difficulty=3K');
    expect(call![5]).toBe('做3K官子题');
    expect(String(call![0])).not.toContain('http');
    expect(String(call![0])).not.toContain('](');
    expect(String(call![0])).not.toContain('&');

    // 历史：assistant 文本里没有链接，链接只在 actionUrl/actionText 字段
    const assistantMsg = hist.addMessage.mock.calls
      .map((c: unknown[]) => c[0] as { role?: string; content?: string; actionUrl?: string; actionText?: string })
      .find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.actionUrl).toBe('/puzzle/index.html?type=%E5%AE%98%E5%AD%90&difficulty=3K');
    expect(assistantMsg!.actionText).toBe('做3K官子题');
    expect(assistantMsg!.content).not.toContain('http');
    expect(assistantMsg!.content).not.toContain('&');
    expect(assistantMsg!.content).not.toContain('](');
  });

  it('多轮：第二轮条件只由本轮工具决定，历史里没有旧链接文本可抄', async () => {
    const gateway = {
      isReady: vi.fn(() => true),
      execute: vi.fn()
        // 第一轮 8K 手筋
        .mockResolvedValueOnce({
          text: '', truncated: false,
          toolCalls: [{ id: 'c1', name: 'navigate_to', arguments: JSON.stringify({
            path: '/puzzle/index.html', label: '做8K手筋题',
            query: { type: '手筋', difficulty: '8K' },
          }) }],
        })
        .mockResolvedValueOnce({ text: '手筋题要点是发现急所。', truncated: false })
        // 第二轮 3K 官子
        .mockResolvedValueOnce({
          text: '', truncated: false,
          toolCalls: [{ id: 'c2', name: 'navigate_to', arguments: JSON.stringify({
            path: '/puzzle/index.html', label: '做3K官子题',
            query: { type: '官子', difficulty: '3K' },
          }) }],
        })
        .mockResolvedValueOnce({ text: '官子题要点是抢先手收束。', truncated: false }),
    } as unknown as IModelGateway & { execute: ReturnType<typeof vi.fn> };

    const r = makeRenderer();
    const hist = makeHistory();
    const uc = makeSkillUseCase(gateway, r, hist);
    await uc.send('做8K手筋题');
    await uc.send('做3K官子题');

    const linkCalls = r.renderMessage.mock.calls.filter(
      (c: unknown[]) => c[4] !== undefined,
    ) as unknown[][];
    expect(linkCalls.length).toBe(2);
    expect(linkCalls[0]![4]).toBe('/puzzle/index.html?type=%E6%89%8B%E7%AD%8B&difficulty=8K');
    expect(linkCalls[1]![4]).toBe('/puzzle/index.html?type=%E5%AE%98%E5%AD%90&difficulty=3K');

    // 历史 assistant 文本里没有任何链接 / & 实体 —— 第二轮模型无从照抄旧链接
    const stored = hist.store as Array<{ content: string }>;
    expect(stored.every((m) => !m.content.includes('http') && !m.content.includes('&'))).toBe(true);
  });
});

/**
 * 技能开发角色 = 闲聊超集：同一个 tool-calling loop，只在 chat 工具集上
 * 追加 skill_list / skill_write 与一段开发 system；闲聊角色零开发能力。
 */
describe('ChatUseCase.send — 技能开发角色（闲聊超集）', () => {
  const webDeps = {
    proxyUrl: 'https://api.weiqi.lol', timeoutMs: 60_000,
    fetchImpl: vi.fn() as unknown as typeof fetch,
  };

  function devKitStub(): SkillDevKit {
    return {
      tools: [
        { name: 'skill_list', description: '列出自建技能', parameters: { type: 'object' } },
        { name: 'skill_write', description: '写自建技能', parameters: { type: 'object' } },
      ],
      executors: {
        skill_list: async () => ({ observation: '空', ok: true, detail: '列出' }),
        skill_write: async () => ({ observation: '已保存', ok: true, detail: '保存' }),
      },
      systemSuffix: '【技能开发能力】测试片段',
      workflowHooks: {
        listCandidates: async () => [],
        accept: async () => {},
      },
    };
  }

  function makeWithRole(gw: IModelGateway, roleId: ChatRoleId) {
    const r = makeRenderer();
    const hist = makeHistory();
    const primitives = createSkillRegistry(createBasicPrimitives(webDeps));
    const skills = {
      loadSkills: async () => TEST_SKILLS,
      primitives,
      devKit: devKitStub(),
      // 测试桩模拟 LLM 路由的「理解力」：按最近用户文本判断意图，
      // 而不是无条件全返回。这不是产品词表，产品里这步是模型调用。
      routeSkills: async (
        recipes: readonly SkillRecipe[],
        input: { recentUserTexts: readonly string[] },
      ) => {
        const text = input.recentUserTexts.join('\n');
        return /做题|官子|手筋|死活/.test(text) ? recipes.map((x) => x.id) : [];
      },
    };
    return {
      r,
      uc: new ChatUseCase(gw, hist, r, undefined, () => roleId, webDeps, skills),
    };
  }

  function firstRequest(gw: ReturnType<typeof makeGateway>) {
    return gw.execute.mock.calls[0]![0] as {
      tools?: Array<{ name: string }>;
      messages: Array<{ role: string; content: string }>;
    };
  }

  it('闲聊角色：不挂开发两工具，system 是纯闲聊 system', async () => {
    const gw = makeGateway();
    const { uc } = makeWithRole(gw, 'chat');
    await uc.send('你好');
    const req = firstRequest(gw);
    const names = (req.tools ?? []).map((t) => t.name);
    expect(names).not.toContain('skill_list');
    expect(names).not.toContain('skill_write');
    expect(req.messages[0]!.content).toBe(CONVERSATION_SYSTEM_PROMPT);
  });

  it('技能开发角色：闲聊 3 个 web 工具仍在，且多出 skill_list / skill_write', async () => {
    const gw = makeGateway();
    const { uc } = makeWithRole(gw, 'dev');
    await uc.send('帮我造个技能');
    const req = firstRequest(gw);
    const names = (req.tools ?? []).map((t) => t.name);
    expect(names).toContain('web_fetch');
    expect(names).toContain('web_read_pdf');
    expect(names).toContain('web_read_image');
    expect(names).toContain('skill_list');
    expect(names).toContain('skill_write');
  });

  it('技能开发角色：system 拼接了闲聊 system + 开发片段（替换制，不丢闲聊上下文）', async () => {
    const gw = makeGateway();
    const { uc } = makeWithRole(gw, 'dev');
    await uc.send('帮我造个技能');
    const sys = firstRequest(gw).messages[0]!.content;
    expect(sys.startsWith(CONVERSATION_SYSTEM_PROMPT)).toBe(true);
    expect(sys).toContain('【技能开发能力】测试片段');
  });

  it('技能开发角色命中配方时：原语 + 开发工具都挂上，system 三段齐全', async () => {
    const gw = makeGateway();
    const { uc } = makeWithRole(gw, 'dev');
    await uc.send('做3K官子题'); // 命中本地已安装的做题配方
    const req = firstRequest(gw);
    const names = (req.tools ?? []).map((t) => t.name);
    expect(names).toContain('navigate_to'); // 命中配方引用的原语
    expect(names).toContain('skill_write'); // 开发工具仍在
    const sys = req.messages[0]!.content;
    expect(sys.startsWith(CONVERSATION_SYSTEM_PROMPT)).toBe(true);
    expect(sys).toContain('【技能开发能力】测试片段');
  });
});

/**
 * compact / checkpoint 集成（P3a）
 *
 * 锁住「宿主内部行为」的四条边界：
 * - 装了 compactor 时，窗口真丢消息才触发；摘要注入本轮上下文（独立 system 消息）；
 * - 摘要调用不写会话历史、不渲染过程块、不挂工具；
 * - 装 compactor 但没丢消息 → 一次额外模型调用都不发；
 * - 上下文溢出 → 同一 turn 封顶重试一次，第二次窗口收最小，普通错误不重试。
 */
describe('ChatUseCase.send — compact 集成', () => {
  /** 造一个必然触发窗口丢弃、但保存完整历史引用的用例 */
  function longCase() {
    const store = Array.from({ length: CONTEXT_LIMITS.maxMessages + 4 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `旧-${i}`,
    }));
    const history = makeHistory(store);
    const gateway = makeGateway();
    const renderer = makeRenderer();
    const compactor = {
      maybeCompact: vi.fn().mockResolvedValue({
        seq: 2, summary: '此前在比较棋手，用户偏好简洁回答', firstKeptIndex: 4,
      }),
      isOverflowError: vi.fn((e: unknown) =>
        e instanceof Error && e.message.includes('context length')),
    };
    const uc = new ChatUseCase(
      gateway, history, renderer, undefined, role('chat'), undefined,
      undefined, undefined,
      // 第 9 参是 compactor；阶段二新增的第 10 参 operatorRegistry 本用例不挂（省略）。
      // 之前误把 compactor 放到第 10 位，导致 compact 整条链根本没接线。
      compactor as unknown as import('../ConversationCompactor').ConversationCompactor,
    );
    return { history, gateway, renderer, compactor, uc, store };
  }

  it('窗口丢弃 → 同步 compact，摘要作为独立 system 注入本轮，且当前句仍是最后一条', async () => {
    const h = longCase();
    await h.uc.send('那他跟李世石呢');
    expect(h.compactor.maybeCompact).toHaveBeenCalledTimes(1);
    const req = h.gateway.execute.mock.calls[0]![0];
    expect(req.messages[0]!.content).toBe(CONVERSATION_SYSTEM_PROMPT);
    expect(req.messages[1]!.role).toBe('system');
    expect(req.messages[1]!.content).toContain('此前在比较棋手');
    expect(req.messages[req.messages.length - 1]!.content).toBe('那他跟李世石呢');
  });

  it('compact 不写历史、不渲染过程块：历史只多出 user / assistant 两条', async () => {
    const h = longCase();
    const before = h.store.length;
    await h.uc.send('继续');
    expect(h.history.addMessage).toHaveBeenCalledTimes(2);
    expect(h.history.getMessages().length).toBe(before + 2);
    expect(h.renderer.beginPluginTrace).not.toHaveBeenCalled();
    expect(h.renderer.appendPluginTraceStep).not.toHaveBeenCalled();
    // 摘要段是 system，不是历史里的消息，也不冒充用户/助手
    const req = h.gateway.execute.mock.calls[0]![0];
    expect(req.messages.filter((m: { role: string }) => m.role === 'system')).toHaveLength(2);
  });

  it('compactor 降级返回 null 时上下文与旧版逐字一致，对话照常', async () => {
    const h = longCase();
    (h.compactor.maybeCompact as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await h.uc.send('继续');
    const req = h.gateway.execute.mock.calls[0]![0];
    expect(req.messages[0]).toEqual({ role: 'system', content: CONVERSATION_SYSTEM_PROMPT });
    expect(req.messages.filter((m: { role: string }) => m.role === 'system')).toHaveLength(1);
    expect(req.messages[req.messages.length - 1]!.content).toBe('继续');
    expect(h.renderer.renderMessage).toHaveBeenLastCalledWith(
      '回复内容', false, null, null, undefined, undefined, true,
    );
  });

  it('上下文溢出：封顶重试一次，重试窗口只留主 system + 摘要 + 当前句', async () => {
    const h = longCase();
    const ok: ModelResult = { text: '已恢复', truncated: false };
    h.gateway.execute
      .mockRejectedValueOnce(new Error('maximum context length exceeded'))
      .mockResolvedValueOnce(ok);
    await h.uc.send('那他跟李世石呢');
    expect(h.gateway.execute).toHaveBeenCalledTimes(2);
    const retry = h.gateway.execute.mock.calls[1]![0];
    expect(retry.messages).toHaveLength(3);
    expect(retry.messages[2]!.content).toBe('那他跟李世石呢');
    expect(h.renderer.renderMessage).toHaveBeenLastCalledWith(
      '已恢复', false, null, null, undefined, undefined, true,
    );
  });

  it('普通错误不重试，照旧渲染失败提示', async () => {
    const h = longCase();
    h.gateway.execute.mockRejectedValue(new Error('请求超时'));
    await h.uc.send('继续');
    expect(h.gateway.execute).toHaveBeenCalledTimes(1);
    expect(h.renderer.renderMessage).toHaveBeenLastCalledWith(
      '❌ 对话失败：请求超时', false, null, null, undefined, undefined, false,
    );
  });
});
