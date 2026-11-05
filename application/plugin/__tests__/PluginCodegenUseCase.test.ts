/**
 * 插件生成/修复循环测试（全部端口 mock）
 *
 * 重点：
 * - 工件中心：prompt 由 intent+当前代码+反馈构造，不传任何会话历史
 * - 每轮都重新校验 + 重新执行（LLM 修复时可能试探越权）
 * - 失败反馈回喂、轮数上限、模型失败/协议失败/校验失败的容错
 */

import { describe, it, expect, vi } from 'vitest';
import { PluginCodegenUseCase, type PluginCodegenOptions } from '../PluginCodegenUseCase';
import { RANKING_SPEC, type AgentResponse, type PluginRunResult, type RepairFeedback } from '@domain/plugin/types';

const goodCode = 'function rank(x){ return x }';

interface Harness {
  options: PluginCodegenOptions;
  gateway: { execute: ReturnType<typeof vi.fn> };
  runtime: { run: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
  validator: { validate: ReturnType<typeof vi.fn> };
  prompts: {
    agentSystemPrompt: ReturnType<typeof vi.fn>;
    buildRepairMessages: ReturnType<typeof vi.fn>;
  };
  protocol: { parse: ReturnType<typeof vi.fn> };
  feedback: { toFeedback: ReturnType<typeof vi.fn> };
}

function harness(overrides?: Partial<PluginCodegenOptions>): Harness {
  const gateway = { execute: vi.fn().mockResolvedValue({ text: 'raw', truncated: false }) };
  const runtime = {
    run: vi.fn().mockResolvedValue({ ok: true, output: [1], logs: [], elapsedMs: 1 } satisfies PluginRunResult),
    dispose: vi.fn(),
  };
  const validator = { validate: vi.fn().mockReturnValue({ ok: true }) };
  const prompts = {
    agentSystemPrompt: vi.fn().mockReturnValue('SYSTEM'),
    buildRepairMessages: vi.fn().mockReturnValue([
      { role: 'user' as const, content: '需求' },
    ]),
  };
  const protocol = {
    parse: vi.fn().mockReturnValue({
      ok: true,
      response: { reply: '已生成', action: { kind: 'plugin.create', code: goodCode } } satisfies AgentResponse,
    }),
  };
  const feedback = {
    toFeedback: vi.fn().mockImplementation(
      (runResult: PluginRunResult, attempt: number, maxAttempts: number): RepairFeedback => ({
        phase: runResult.ok ? 'runtime' : runResult.phase,
        ok: false,
        error: runResult.ok ? { name: 'E', message: 'boom' } : runResult.error,
        attempt,
        maxAttempts,
      }),
    ),
  };
  const options: PluginCodegenOptions = {
    gateway: gateway as unknown as PluginCodegenOptions['gateway'],
    runtime: runtime as unknown as PluginCodegenOptions['runtime'],
    validator: validator as unknown as PluginCodegenOptions['validator'],
    prompts: prompts as unknown as PluginCodegenOptions['prompts'],
    protocol: protocol as unknown as PluginCodegenOptions['protocol'],
    feedback: feedback as unknown as PluginCodegenOptions['feedback'],
    maxAttempts: 3,
    ...overrides,
  };
  return { options, gateway, runtime, validator, prompts, protocol, feedback };
}

const baseReq = { intent: '同分先比胜局', sampleInput: [{ score: 1 }] };

describe('PluginCodegenUseCase', () => {
  it('首轮成功即返回代码与试算输出', async () => {
    const h = harness();
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(goodCode);
    expect(result.output).toEqual([1]);
    expect(result.attempts).toBe(1);
    expect(h.runtime.run).toHaveBeenCalledTimes(1);
  });

  it('trace 逐轮记录 llm / 校验 / 沙箱，且带完整源码', async () => {
    const h = harness();
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.trace.every((s) => s.source === 'codegen')).toBe(true);
    expect(result.trace.some((s) => s.phase === 'llm' && s.code === goodCode)).toBe(true);
    expect(result.trace.some((s) => s.phase === 'sandbox' && s.ok)).toBe(true);
    expect(result.trace.every((s) => s.attempt >= 1 && typeof s.detail === 'string')).toBe(true);
  });

  it('失败轮也写进 trace，并把失败原因暴露给用户', async () => {
    const h = harness();
    h.runtime.run
      .mockResolvedValueOnce({ ok: false, phase: 'runtime', error: { name: 'TypeError', message: 'bad' }, logs: [], elapsedMs: 1 } satisfies PluginRunResult)
      .mockResolvedValueOnce({ ok: true, output: [2], logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    const failed = result.trace.filter((s) => !s.ok);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.some((s) => s.detail.includes('bad'))).toBe(true);
    expect(result.trace.some((s) => s.phase === 'sandbox' && s.ok)).toBe(true);
  });

  it('模型调用失败也带 trace（不丢过程）', async () => {
    const h = harness();
    h.gateway.execute.mockRejectedValue(new Error('网络超时'));
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(false);
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]!.ok).toBe(false);
    expect(result.trace[0]!.phase).toBe('llm');
    expect(result.trace[0]!.detail).toContain('网络超时');
  });

  it('system prompt 带插件清单，且 messages 不含任何会话历史', async () => {
    const h = harness();
    const snapshot = [{ id: 'p1', name: '旧规则', enabled: true }];
    await new PluginCodegenUseCase(h.options).run({ ...baseReq, snapshot });
    expect(h.prompts.agentSystemPrompt).toHaveBeenCalledWith(snapshot, 3);
    const req = h.gateway.execute.mock.calls[0]![0] as { messages: Array<{ role: string; content: string }>; task: string };
    expect(req.task).toBe('plugin.generate');
    expect(req.messages[0].role).toBe('system');
    expect(req.messages[0].content).toBe('SYSTEM');
    // 只有 system + 需求，没有额外的历史对话轮次
    expect(req.messages).toHaveLength(2);
  });

  it('执行失败时把反馈回喂给下一轮', async () => {
    const h = harness();
    h.runtime.run
      .mockResolvedValueOnce({ ok: false, phase: 'runtime', error: { name: 'TypeError', message: 'bad' }, logs: [], elapsedMs: 1 } satisfies PluginRunResult)
      .mockResolvedValueOnce({ ok: true, output: [2], logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(h.feedback.toFeedback).toHaveBeenCalledTimes(1);
    // 第二轮 buildRepairMessages 收到的 feedback 是结构化反馈对象，不是会话
    const secondCall = h.prompts.buildRepairMessages.mock.calls[1]!;
    expect(secondCall[2]).toMatchObject({ phase: 'runtime', ok: false });
  });

  it('用户验收反馈作为首轮输入（工件中心，会话无关）', async () => {
    const h = harness();
    await new PluginCodegenUseCase(h.options).run({
      ...baseReq,
      currentCode: 'function rank(x){ return x.reverse() }',
      userFeedback: '排错了，同分先比胜局',
    });
    const firstCall = h.prompts.buildRepairMessages.mock.calls[0]!;
    expect(firstCall[0]).toBe('同分先比胜局');
    expect(firstCall[1]).toContain('reverse');
    expect(firstCall[2]).toBe('排错了，同分先比胜局');
  });

  it('每轮都重新校验代码（不只验第一轮）', async () => {
    const h = harness();
    h.runtime.run
      .mockResolvedValueOnce({ ok: false, phase: 'compile', error: { name: 'SyntaxError', message: 'x' }, logs: [], elapsedMs: 1 } satisfies PluginRunResult)
      .mockResolvedValueOnce({ ok: true, output: [], logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(h.validator.validate).toHaveBeenCalledTimes(2);
    expect(h.runtime.run).toHaveBeenCalledTimes(2);
  });

  it('校验失败不进入沙箱，直接生成反馈', async () => {
    const h = harness();
    h.validator.validate.mockReturnValueOnce({ ok: false, reason: '含 fetch' });
    h.runtime.run.mockResolvedValue({ ok: true, output: [], logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(h.runtime.run).toHaveBeenCalledTimes(1); // 第一轮被校验挡掉
    expect(h.feedback.toFeedback).not.toHaveBeenCalled(); // 校验失败不用归一执行反馈
  });

  it('轮数用尽返回失败，并保留最后一版代码与反馈', async () => {
    const h = harness({ maxAttempts: 2 });
    h.runtime.run.mockResolvedValue({ ok: false, phase: 'timeout', error: { name: 'InternalError', message: 'interrupted' }, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.code).toBe(goodCode);
    expect(result.lastFeedback?.phase).toBe('timeout');
    expect(h.runtime.run).toHaveBeenCalledTimes(2);
  });

  it('模型调用失败立即返回，不消耗后续轮次', async () => {
    const h = harness();
    h.gateway.execute.mockRejectedValue(new Error('网络超时'));
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.reply).toContain('网络超时');
    expect(h.runtime.run).not.toHaveBeenCalled();
  });

  it('协议解析失败时可从代码围栏兜底并继续', async () => {
    const h = harness();
    h.protocol.parse.mockReturnValue({ ok: false, reason: '非法 JSON' });
    h.gateway.execute.mockResolvedValue({ text: '```js\nfunction rank(x){ return x }\n```', truncated: false });
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(goodCode);
  });

  it('既无 action.code 也无围栏时给出契约反馈并重试', async () => {
    const h = harness({ maxAttempts: 1 });
    h.protocol.parse.mockReturnValue({ ok: false, reason: '非法 JSON' });
    h.gateway.execute.mockResolvedValue({ text: '我只解释一下', truncated: false });
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(false);
    expect(result.lastFeedback?.error?.name).toBe('ProtocolError');
    expect(h.runtime.run).not.toHaveBeenCalled();
  });

  it('沙箱抛异常被当作可恢复失败而非整个循环崩溃', async () => {
    const h = harness();
    h.runtime.run.mockRejectedValueOnce(new Error('worker died'));
    h.runtime.run.mockResolvedValueOnce({ ok: true, output: [3], logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('maxAttempts 至少为 1', async () => {
    const h = harness({ maxAttempts: 0 });
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('使用传入的 spec 而非写死 RANKING_SPEC', async () => {
    const h = harness();
    const customSpec = { ...RANKING_SPEC, entry: 'compute' };
    await new PluginCodegenUseCase(h.options).run({ ...baseReq, spec: customSpec });
    expect(h.runtime.run).toHaveBeenCalledWith(goodCode, baseReq.sampleInput, customSpec);
    expect(h.validator.validate).toHaveBeenCalledWith(goodCode, customSpec);
  });
});
