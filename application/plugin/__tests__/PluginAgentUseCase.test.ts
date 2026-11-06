/**
 * 插件智能体用例测试
 *
 * 覆盖：插件随时可见（每次请求注入快照）、纯聊天不被破坏、动作执行、
 * 工件中心（会话丢失仍可修订）、人工闸门（创建默认不启用）、
 * 观测回喂、协议失败降级、决策次数上限。
 */

import { describe, it, expect, vi } from 'vitest';
import { PluginAgentUseCase, type PluginAgentOptions } from '../PluginAgentUseCase';
import { RANKING_SPEC, type AgentResponse, type PluginContextEntry } from '@domain/plugin/types';

const code = 'function rank(x){ return x }';

interface Harness {
  options: PluginAgentOptions;
  gateway: { execute: ReturnType<typeof vi.fn> };
  prompts: { agentSystemPrompt: ReturnType<typeof vi.fn> };
  protocol: { parse: ReturnType<typeof vi.fn> };
  validator: { validate: ReturnType<typeof vi.fn> };
  runtime: { run: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
  artifacts: {
    create: ReturnType<typeof vi.fn>;
    revise: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  snapshot: { snapshot: ReturnType<typeof vi.fn>; withCode: ReturnType<typeof vi.fn> };
  codegen: { run: ReturnType<typeof vi.fn> };
}

function harness(): Harness {
  const gateway = { execute: vi.fn().mockResolvedValue({ text: '{}', truncated: false }) };
  const prompts = { agentSystemPrompt: vi.fn().mockReturnValue('SYSTEM') };
  const protocol = {
    parse: vi.fn().mockReturnValue({
      ok: true,
      response: { reply: '好的', action: { kind: 'none' } } satisfies AgentResponse,
    }),
  };
  const validator = { validate: vi.fn().mockReturnValue({ ok: true }) };
  const runtime = { run: vi.fn(), dispose: vi.fn() };
  const artifacts = {
    create: vi.fn().mockResolvedValue({ id: 'plugin:new' }),
    revise: vi.fn().mockResolvedValue({ id: 'plugin:old' }),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  };
  const snapshot: PluginContextEntry[] = [
    { id: 'plugin:old', name: '旧规则', pointId: 'ranking.tiebreak', enabled: true, version: 2, intent: '同分比胜局' },
  ];
  const snapshotProvider = {
    snapshot: vi.fn().mockResolvedValue(snapshot),
    withCode: vi.fn().mockResolvedValue({
      ...snapshot[0]!, code,
    }),
  };
  const codegen = {
    run: vi.fn().mockResolvedValue({
      ok: true, code, output: [], attempts: 1, reply: '已生成',
      trace: [{ source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: true, detail: '试算通过' }],
    }),
  };
  const options: PluginAgentOptions = {
    gateway: gateway as unknown as PluginAgentOptions['gateway'],
    prompts: prompts as unknown as PluginAgentOptions['prompts'],
    protocol: protocol as unknown as PluginAgentOptions['protocol'],
    validator: validator as unknown as PluginAgentOptions['validator'],
    runtime: runtime as unknown as PluginAgentOptions['runtime'],
    artifacts: artifacts as unknown as PluginAgentOptions['artifacts'],
    snapshot: snapshotProvider as unknown as PluginAgentOptions['snapshot'],
    codegen: codegen as unknown as PluginAgentOptions['codegen'],
    maxAttempts: 3,
  };
  return { options, gateway, prompts, protocol, validator, runtime, artifacts, snapshot: snapshotProvider, codegen };
}


function setResponses(h: Harness, responses: Array<{ ok: true; response: AgentResponse } | { ok: false; reason: string }>) {
  let i = 0;
  h.protocol.parse.mockImplementation(() => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return r;
  });
}

const ok = (reply: string, action: AgentResponse['action']) => ({ ok: true as const, response: { reply, action } });

describe('PluginAgentUseCase', () => {
  it('纯聊天：action=none 直接返回，且每次都注入插件快照', async () => {
    const h = harness();
    const result = await new PluginAgentUseCase(h.options).turn({ text: '你好' });
    expect(result.acted).toBe(false);
    expect(result.reply).toBe('好的');
    // 所有 return 都带 trace（过程日志可见性）
    expect(result.trace).toBeDefined();
    expect(result.trace!.some((s) => s.source === 'agent' && s.phase === 'decision')).toBe(true);
    expect(result.trace!.some((s) => s.phase === 'final')).toBe(true);
    expect(h.prompts.agentSystemPrompt).toHaveBeenCalledTimes(1);
    expect(h.snapshot.snapshot).toHaveBeenCalledTimes(1);
    const req = h.gateway.execute.mock.calls[0]![0] as { messages: Array<{ role: string; content: string }>; task: string };
    expect(req.task).toBe('chat.reply');
    expect(req.messages[0].content).toBe('SYSTEM');
  });

  it('会话历史只作聊天上下文，不影响插件能力', async () => {
    const h = harness();
    await new PluginAgentUseCase(h.options).turn({
      text: '继续',
      history: [{ role: 'user', content: '之前说过' }, { role: 'assistant', content: '嗯' }],
    });
    const req = h.gateway.execute.mock.calls[0]![0] as { messages: Array<{ role: string; content: string }> };
    expect(req.messages).toHaveLength(4); // system + 2 历史 + 当前
    expect(req.messages[1].content).toBe('之前说过');
  });

  it('plugin.show 走 withCode 取全量源码回喂，不凭记忆编造', async () => {
    const h = harness();
    setResponses(h, [ok('看源码', { kind: 'plugin.show', artifactId: 'plugin:old' }), ok('这是源码', { kind: 'none' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '把旧规则源码给我' });
    expect(result.reply).toBe('这是源码');
    expect(h.snapshot.withCode).toHaveBeenCalledWith('plugin:old');
    const second = h.gateway.execute.mock.calls[1]![0] as { messages: Array<{ content: string }> };
    const observation = second.messages.at(-1)!.content;
    expect(observation).toContain(code);
    expect(observation).toContain('完整源码');
    expect(observation).toContain('原样放进 reply');
  });

  it('plugin.show 缺 artifactId / 找不到插件时给观测而非崩溃', async () => {
    const h = harness();
    setResponses(h, [ok('看', { kind: 'plugin.show' }), ok('好的', { kind: 'none' })]);
    await new PluginAgentUseCase(h.options).turn({ text: '看' });
    expect(h.snapshot.withCode).not.toHaveBeenCalled();
    expect(h.gateway.execute).toHaveBeenCalledTimes(2);
  });

  it('plugin.show 找不到插件时回喂明确观测', async () => {
    const h = harness();
    h.snapshot.withCode.mockResolvedValue(null);
    setResponses(h, [ok('看', { kind: 'plugin.show', artifactId: 'plugin:missing' }), ok('好的', { kind: 'none' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '看' });
    expect(result.reply).toBe('好的');
    const second = h.gateway.execute.mock.calls[1]![0] as { messages: Array<{ content: string }> };
    expect(second.messages.at(-1)!.content).toContain('找不到插件');
  });

  it('plugin.list 动作把清单作为观测回喂，再给出最终回复', async () => {
    const h = harness();
    setResponses(h, [ok('查一下', { kind: 'plugin.list' }), ok('这是插件清单', { kind: 'none' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '有哪些插件' });
    expect(result.reply).toBe('这是插件清单');
    expect(h.gateway.execute).toHaveBeenCalledTimes(2);
    const second = h.gateway.execute.mock.calls[1]![0] as { messages: Array<{ content: string }> };
    expect(second.messages.at(-1)!.content).toContain('plugin:old');
  });

  it('plugin.create 生成候选，默认不启用（人工闸门）', async () => {
    const h = harness();
    setResponses(h, [ok('我来写', { kind: 'plugin.create', intent: '同分先比胜局', code: 'x' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '写个排名规则' });
    expect(result.acted).toBe(true);
    expect(result.artifactId).toBe('plugin:new');
    // codegen 的逐轮 trace 并入总 trace（用户要看到 LLM 调试过程）
    expect(result.trace!.some((s) => s.source === 'codegen' && s.phase === 'sandbox')).toBe(true);
    expect(result.trace!.some((s) => s.source === 'agent')).toBe(true);
    expect(h.artifacts.create).toHaveBeenCalledWith(expect.objectContaining({
      intent: '同分先比胜局', origin: 'llm', pointId: 'ranking.tiebreak',
    }));
    // 关键：没有调用 setEnabled(true)
    expect(h.artifacts.setEnabled).not.toHaveBeenCalled();
  });

  it('plugin.create 用户明确起名 → 用用户指定的名字', async () => {
    const h = harness();
    setResponses(h, [ok('写', { kind: 'plugin.create', name: '同分比胜局', intent: 'x', code: 'x' })]);
    await new PluginAgentUseCase(h.options).turn({ text: '写个规则' });
    expect(h.artifacts.create).toHaveBeenCalledWith(expect.objectContaining({ name: '同分比胜局' }));
  });

  it('plugin.create 未起名 → 自动「规则N」，基于当前清单防重名', async () => {
    const h = harness();
    // 现有快照里只有「旧规则」，不占编号 → 规则1
    setResponses(h, [ok('写', { kind: 'plugin.create', intent: 'x', code: 'x' })]);
    await new PluginAgentUseCase(h.options).turn({ text: '写个规则' });
    expect(h.artifacts.create).toHaveBeenCalledWith(expect.objectContaining({ name: '规则1' }));
  });

  it('plugin.create 未起名且「规则1」已存在 → 顺延到规则2', async () => {
    const h = harness();
    h.snapshot.snapshot.mockResolvedValue([
      { id: 'plugin:a', name: '规则1', pointId: 'ranking.tiebreak', enabled: false, version: 1, intent: 'x' },
    ]);
    setResponses(h, [ok('写', { kind: 'plugin.create', intent: 'x', code: 'x' })]);
    await new PluginAgentUseCase(h.options).turn({ text: '写个规则' });
    expect(h.artifacts.create).toHaveBeenCalledWith(expect.objectContaining({ name: '规则2' }));
  });

  it('plugin.create 把 onTrace 实时透传给 codegen', async () => {
    const h = harness();
    setResponses(h, [ok('写', { kind: 'plugin.create', intent: 'x', code: 'x' })]);
    const onTrace = vi.fn();
    await new PluginAgentUseCase(h.options).turn({ text: '写个规则', onTrace });
    expect(h.codegen.run).toHaveBeenCalledWith(expect.objectContaining({ onTrace }));
    // 外层 agent 自身的步骤也走同一个 sink 实时推送
    expect(onTrace).toHaveBeenCalled();
    expect(onTrace.mock.calls.some((c) => c[0].source === 'agent')).toBe(true);
  });

  it('plugin.revise 从工件读 code/intent，不依赖会话（会话丢失场景）', async () => {
    const h = harness();
    h.artifacts.get.mockResolvedValue({
      id: 'plugin:old', code: 'function rank(x){ return x.reverse() }',
      intent: '原始需求', spec: RANKING_SPEC,
    });
    setResponses(h, [ok('改一下', { kind: 'plugin.revise', artifactId: 'plugin:old', feedback: '排反了' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '这个规则排反了' });
    expect(result.acted).toBe(true);
    expect(result.artifactId).toBe('plugin:old');
    expect(h.artifacts.revise).toHaveBeenCalledWith('plugin:old', expect.objectContaining({
      trigger: 'user-feedback', feedback: '排反了',
    }));
    expect(h.codegen.run).toHaveBeenCalledWith(expect.objectContaining({
      intent: '原始需求',
      currentCode: 'function rank(x){ return x.reverse() }',
    }));
  });

  it('codegen 失败时把观测回喂给模型继续决策', async () => {
    const h = harness();
    h.codegen.run.mockResolvedValue({ ok: false, code: '', attempts: 3, reply: '失败', lastFeedback: { phase: 'runtime', ok: false, error: { name: 'E', message: 'boom' }, attempt: 3, maxAttempts: 3 } });
    setResponses(h, [ok('写', { kind: 'plugin.create', code: 'x' }), ok('放弃', { kind: 'none' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '写个规则' });
    expect(result.acted).toBe(false);
    expect(result.reply).toBe('放弃');
    expect(h.artifacts.create).not.toHaveBeenCalled();
    const second = h.gateway.execute.mock.calls[1]![0] as { messages: Array<{ content: string }> };
    expect(second.messages.at(-1)!.content).toContain('boom');
  });

  it('候选代码二次校验失败时不写入工件', async () => {
    const h = harness();
    h.validator.validate.mockReturnValue({ ok: false, reason: '含 fetch' });
    setResponses(h, [ok('写', { kind: 'plugin.create', code: 'x' }), ok('算了', { kind: 'none' })]);
    await new PluginAgentUseCase(h.options).turn({ text: '写个规则' });
    expect(h.artifacts.create).not.toHaveBeenCalled();
  });

  it('协议解析失败降级为纯文本聊天，不破坏对话页', async () => {
    const h = harness();
    h.protocol.parse.mockReturnValue({ ok: false, reason: '非法 JSON' });
    h.gateway.execute.mockResolvedValue({ text: '随便聊聊', truncated: false });
    const result = await new PluginAgentUseCase(h.options).turn({ text: '你好' });
    expect(result.acted).toBe(false);
    expect(result.reply).toBe('随便聊聊');
    expect(result.trace!.some((s) => s.phase === 'protocol' && !s.ok)).toBe(true);
  });

  it('模型调用失败安全返回，且带失败 trace', async () => {
    const h = harness();
    h.gateway.execute.mockRejectedValue(new Error('超时'));
    const result = await new PluginAgentUseCase(h.options).turn({ text: '你好' });
    expect(result.reply).toContain('超时');
    expect(result.acted).toBe(false);
    expect(result.trace!.some((s) => !s.ok && s.detail.includes('超时'))).toBe(true);
  });

  it('codegen 不带 trace 时优雅降级（兼容旧实现）', async () => {
    const h = harness();
    h.codegen.run.mockResolvedValue({ ok: true, code, output: [], attempts: 1, reply: '已生成' });
    setResponses(h, [ok('写', { kind: 'plugin.create', code: 'x' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '写个规则' });
    expect(result.acted).toBe(true);
    expect(result.trace!.every((s) => s.source === 'agent')).toBe(true);
  });

  it('plugin.toggle 按当前快照切换状态', async () => {
    const h = harness();
    h.artifacts.get.mockResolvedValue({ id: 'plugin:old', code: 'x', intent: 'y', spec: RANKING_SPEC });
    setResponses(h, [ok('切', { kind: 'plugin.toggle', artifactId: 'plugin:old' }), ok('已切换', { kind: 'none' })]);
    await new PluginAgentUseCase(h.options).turn({ text: '停用旧规则' });
    expect(h.artifacts.setEnabled).toHaveBeenCalledWith('plugin:old', false);
  });

  it('plugin.toggle 显式 enabled:true → 设为启用，不依赖快照翻转', async () => {
    const h = harness();
    h.artifacts.get.mockResolvedValue({ id: 'plugin:old', code: 'x', intent: 'y', spec: RANKING_SPEC });
    setResponses(h, [ok('切', { kind: 'plugin.toggle', artifactId: 'plugin:old', enabled: true }), ok('已启用', { kind: 'none' })]);
    await new PluginAgentUseCase(h.options).turn({ text: '启用旧规则' });
    expect(h.artifacts.setEnabled).toHaveBeenCalledWith('plugin:old', true);
  });

  it('plugin.toggle 显式 enabled:false → 设为停用', async () => {
    const h = harness();
    h.artifacts.get.mockResolvedValue({ id: 'plugin:old', code: 'x', intent: 'y', spec: RANKING_SPEC });
    setResponses(h, [ok('切', { kind: 'plugin.toggle', artifactId: 'plugin:old', enabled: false }), ok('已停用', { kind: 'none' })]);
    await new PluginAgentUseCase(h.options).turn({ text: '停用旧规则' });
    expect(h.artifacts.setEnabled).toHaveBeenCalledWith('plugin:old', false);
  });

  it('模型只在 reply 里声称「已启用」却没发 toggle → 拦截，不返回假成功', async () => {
    const h = harness();
    setResponses(h, [ok('已经启用好了，可以直接用了', { kind: 'none' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '启用插件' });
    expect(h.artifacts.setEnabled).not.toHaveBeenCalled();
    expect(result.reply).toContain('插件状态未改变');
    expect(result.reply).toContain('真实状态');
    expect(result.reply).not.toContain('已经启用好了');
  });

  it('本轮已执行 toggle 后再回「已启用」→ 不拦截（stateChanged 生效）', async () => {
    const h = harness();
    h.artifacts.get.mockResolvedValue({ id: 'plugin:old', code: 'x', intent: 'y', spec: RANKING_SPEC });
    setResponses(h, [
      ok('切', { kind: 'plugin.toggle', artifactId: 'plugin:old', enabled: true }),
      ok('已启用，可以生效了', { kind: 'none' }),
    ]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '启用旧规则' });
    expect(h.artifacts.setEnabled).toHaveBeenCalledWith('plugin:old', true);
    expect(result.reply).toContain('已启用');
    expect(result.reply).not.toContain('插件状态未改变');
  });

  it('plugin.delete 删除工件', async () => {
    const h = harness();
    setResponses(h, [ok('删', { kind: 'plugin.delete', artifactId: 'plugin:old' }), ok('已删除', { kind: 'none' })]);
    await new PluginAgentUseCase(h.options).turn({ text: '删掉' });
    expect(h.artifacts.remove).toHaveBeenCalledWith('plugin:old');
  });

  it('缺少 artifactId 的动作给出观测而非崩溃', async () => {
    const h = harness();
    setResponses(h, [ok('删', { kind: 'plugin.delete' }), ok('好的', { kind: 'none' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '删掉' });
    expect(result.reply).toBe('好的');
    expect(h.artifacts.remove).not.toHaveBeenCalled();
  });

  it('onTrace 覆盖所有 return 分支（决策/协议/观测/最终）', async () => {
    const h = harness();
    setResponses(h, [ok('列一下', { kind: 'plugin.list' }), ok('好的', { kind: 'none' })]);
    const onTrace = vi.fn();
    await new PluginAgentUseCase(h.options).turn({ text: '列一下', onTrace });
    expect(onTrace.mock.calls.length).toBeGreaterThanOrEqual(4);
    const phases = onTrace.mock.calls.map((c) => c[0].phase);
    expect(phases).toContain('decision');
    expect(phases).toContain('observe');
    expect(phases).toContain('final');
  });

  it('onTrace 抛异常不影响 Agent 主流程（纯展示隔离）', async () => {
    const h = harness();
    const onTrace = vi.fn(() => { throw new Error('渲染炸了'); });
    const result = await new PluginAgentUseCase(h.options).turn({ text: '你好', onTrace });
    expect(result.reply).toBe('好的');
    expect(onTrace).toHaveBeenCalled();
  });

  it('决策次数上限后收敛，不会无限循环，且带完整 trace', async () => {
    const h = harness();
    setResponses(h, [ok('列一下', { kind: 'plugin.list' })]);
    const result = await new PluginAgentUseCase(h.options).turn({ text: '反复列' });
    expect(h.gateway.execute).toHaveBeenCalledTimes(4); // maxAttempts 3 + 1
    expect(result.reply).toContain('次数已用尽');
    expect(result.trace!.length).toBeGreaterThan(4);
    expect(result.trace!.every((s) => s.source === 'agent')).toBe(true);
  });
});
