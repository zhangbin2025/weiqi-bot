/**
 * 插件生成/修复循环测试（全部端口 mock）
 *
 * 重点：
 * - 工件中心：prompt 由 intent+当前代码+反馈构造，不传任何会话历史
 * - 每轮都重新校验 + 重新执行（LLM 修复时可能试探越权）
 * - 试算默认喂代表性对阵样例，不在 [] 上空跑通过
 * - 沙箱输出还要按统一契约校验（能跑 ≠ 合契约）
 * - 失败反馈回喂、轮数上限、模型失败/协议失败/校验失败的容错
 * - 修订标准范式（edit(state, instruction) -> state'）：四元分离、指令保真、
 *   显式变更检测、指令满足度验收（verifier）、不满足回喂
 */

import { describe, it, expect, vi } from 'vitest';
import { PluginCodegenUseCase, type PluginCodegenOptions } from '../PluginCodegenUseCase';
import { RANKING_SPEC, type AgentResponse, type PluginRunResult, type RepairFeedback } from '@domain/plugin/types';
import { SAMPLE_RANKING_INPUT } from '@domain/ranking/sampleInput';

const goodCode = 'function rank(input){ return { columns:[{key:"score",label:"积分"}], rows:[] } }';

/** 合法排名输出，覆盖 SAMPLE_RANKING_INPUT 里的甲/乙/丙 */
const validOutput = {
  columns: [{ key: 'score', label: '积分' }],
  rows: [
    { id: 1, name: '甲', rank: 1, cells: { score: 4 } },
    { id: 2, name: '乙', rank: 2, cells: { score: 2 } },
    { id: 3, name: '丙', rank: 3, cells: { score: 2 } },
  ],
};

interface Harness {
  options: PluginCodegenOptions;
  gateway: { execute: ReturnType<typeof vi.fn> };
  runtime: { run: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
  validator: { validate: ReturnType<typeof vi.fn> };
  prompts: {
    agentSystemPrompt: ReturnType<typeof vi.fn>;
    codegenSystemPrompt: ReturnType<typeof vi.fn>;
    buildRepairMessages: ReturnType<typeof vi.fn>;
  };
  protocol: { parse: ReturnType<typeof vi.fn> };
  feedback: { toFeedback: ReturnType<typeof vi.fn> };
  verifier: { verify: ReturnType<typeof vi.fn> };
}

function harness(overrides?: Partial<PluginCodegenOptions>): Harness {
  const gateway = { execute: vi.fn().mockResolvedValue({ text: 'raw', truncated: false }) };
  const runtime = {
    run: vi.fn().mockResolvedValue({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult),
    dispose: vi.fn(),
  };
  const validator = { validate: vi.fn().mockReturnValue({ ok: true }) };
  const prompts = {
    agentSystemPrompt: vi.fn().mockReturnValue('AGENT_SYSTEM'),
    codegenSystemPrompt: vi.fn().mockReturnValue('CODEGEN_SYSTEM'),
    buildRepairMessages: vi.fn().mockReturnValue([
      { role: 'system' as const, content: 'REPAIR_SYSTEM' },
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
  // 默认验证器判「满足」：首次生成不调用它，修订时不影响既有成功路径
  const verifier = {
    verify: vi.fn().mockResolvedValue({ satisfied: true, reason: '', available: true }),
  };
  const options: PluginCodegenOptions = {
    gateway: gateway as unknown as PluginCodegenOptions['gateway'],
    runtime: runtime as unknown as PluginCodegenOptions['runtime'],
    validator: validator as unknown as PluginCodegenOptions['validator'],
    prompts: prompts as unknown as PluginCodegenOptions['prompts'],
    protocol: protocol as unknown as PluginCodegenOptions['protocol'],
    feedback: feedback as unknown as PluginCodegenOptions['feedback'],
    verifier: verifier as unknown as PluginCodegenOptions['verifier'],
    maxAttempts: 3,
    ...overrides,
  };
  return { options, gateway, runtime, validator, prompts, protocol, feedback, verifier };
}

// 不传 sampleInput：走默认代表性样例（覆盖轮空/未完赛，不在空数组上空跑）
const baseReq = { intent: '同分先比胜局' };

describe('PluginCodegenUseCase', () => {
  it('首轮成功即返回代码与试算输出', async () => {
    const h = harness();
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(goodCode);
    expect(result.output).toEqual(validOutput);
    expect(result.attempts).toBe(1);
    expect(h.runtime.run).toHaveBeenCalledTimes(1);
  });

  it('默认喂代表性对阵样例（避免 [] 上空跑试算通过）', async () => {
    const h = harness();
    await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(h.runtime.run).toHaveBeenCalledWith(goodCode, SAMPLE_RANKING_INPUT, RANKING_SPEC);
  });

  it('沙箱输出不符合契约 → 回喂修复并重试（能跑≠合契约）', async () => {
    const h = harness();
    h.runtime.run
      .mockResolvedValueOnce({ ok: true, output: [{ id: 1, rank: 1 }], logs: [], elapsedMs: 1 } satisfies PluginRunResult) // 旧数组契约
      .mockResolvedValueOnce({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.trace.some((s) => s.phase === 'contract' && !s.ok)).toBe(true);
  });

  it('含字符串 cell 的输出被契约校验拦下', async () => {
    const h = harness();
    const bad = {
      columns: [{ key: 'score', label: '积分' }],
      rows: validOutput.rows.map((r) => ({ ...r, cells: { score: '4' } })),
    };
    h.runtime.run
      .mockResolvedValueOnce({ ok: true, output: bad, logs: [], elapsedMs: 1 } satisfies PluginRunResult)
      .mockResolvedValueOnce({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.attempts).toBe(2);
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
      .mockResolvedValueOnce({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
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
    expect(result.trace).toHaveLength(2);
    expect(result.trace[0]!.ok).toBe(true);
    expect(result.trace[0]!.detail).toContain('正在调用模型');
    expect(result.trace[1]!.ok).toBe(false);
    expect(result.trace[1]!.phase).toBe('llm');
    expect(result.trace[1]!.detail).toContain('网络超时');
  });

  it('过程块在模型返回之前就点亮：onTrace 先于 gateway.execute 完成', async () => {
    const h = harness();
    let resolveGateway: ((v: { text: string; truncated: boolean }) => void) | undefined;
    const pending = new Promise<{ text: string; truncated: boolean }>((r) => { resolveGateway = r; });
    h.gateway.execute.mockReturnValue(pending);
    const seen: string[] = [];
    const runPromise = new PluginCodegenUseCase(h.options).run({
      ...baseReq,
      onTrace: (s) => seen.push(s.detail),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toContain('正在调用模型');
    resolveGateway!({ text: 'raw', truncated: false });
    await runPromise;
  });

  it('onTrace 实时推送：每步产生时立刻回调，顺序与 result.trace 一致', async () => {
    const h = harness();
    const seen: Array<{ phase: string; ok: boolean }> = [];
    const onTrace = vi.fn((s) => { seen.push({ phase: s.phase, ok: s.ok }); });
    const result = await new PluginCodegenUseCase(h.options).run({ ...baseReq, onTrace });
    expect(onTrace).toHaveBeenCalledTimes(result.trace.length);
    expect(seen).toEqual(result.trace.map((s) => ({ phase: s.phase, ok: s.ok })));
    expect(seen.length).toBeGreaterThan(0);
  });

  it('onTrace 逐轮实时：首轮失败时回调已发生，不等整轮结束', async () => {
    const h = harness();
    h.runtime.run
      .mockResolvedValueOnce({ ok: false, phase: 'runtime', error: { name: 'E', message: 'bad' }, logs: [], elapsedMs: 1 } satisfies PluginRunResult)
      .mockResolvedValueOnce({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const phases: string[] = [];
    await new PluginCodegenUseCase(h.options).run({
      ...baseReq,
      onTrace: (s) => phases.push(`${s.attempt}:${s.phase}`),
    });
    expect(phases.some((p) => p.startsWith('1:'))).toBe(true);
    expect(phases.some((p) => p.startsWith('2:'))).toBe(true);
  });

  it('onTrace 抛异常不影响代码生成主流程（纯展示隔离）', async () => {
    const h = harness();
    const onTrace = vi.fn(() => { throw new Error('渲染炸了'); });
    const result = await new PluginCodegenUseCase(h.options).run({ ...baseReq, onTrace });
    expect(result.ok).toBe(true);
    expect(onTrace).toHaveBeenCalled();
  });

  it('codegen 用独立极简 system prompt、接回修订 system、且不含会话历史', async () => {
    const h = harness();
    const snapshot = [{ id: 'p1', name: '旧规则', enabled: true }];
    await new PluginCodegenUseCase(h.options).run({ ...baseReq, snapshot });
    expect(h.prompts.codegenSystemPrompt).toHaveBeenCalledWith(snapshot, 3);
    expect(h.prompts.agentSystemPrompt).not.toHaveBeenCalled();
    const req = h.gateway.execute.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
      task: string;
      options?: { jsonMode?: boolean };
    };
    expect(req.task).toBe('plugin.generate');
    expect(req.messages[0].role).toBe('system');
    expect(req.messages[0].content).toContain('CODEGEN_SYSTEM');
    // 修订 system 不再被 filter 丢弃
    expect(req.messages[0].content).toContain('REPAIR_SYSTEM');
    expect(req.messages).toHaveLength(2);
  });

  it('不再强制 jsonMode（整段 JS 源码不塞进 JSON 字符串）', async () => {
    const h = harness();
    await new PluginCodegenUseCase(h.options).run(baseReq);
    const req = h.gateway.execute.mock.calls[0]![0] as { options?: { jsonMode?: boolean } };
    expect(req.options?.jsonMode).toBe(false);
  });

  it('未注入 codegenSystemPrompt 时回落 agentSystemPrompt（兼容旧装配）', async () => {
    const h = harness();
    delete (h.options.prompts as unknown as { codegenSystemPrompt?: unknown }).codegenSystemPrompt;
    await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(h.prompts.agentSystemPrompt).toHaveBeenCalled();
  });

  it('执行失败时把反馈回喂给下一轮', async () => {
    const h = harness();
    h.runtime.run
      .mockResolvedValueOnce({ ok: false, phase: 'runtime', error: { name: 'TypeError', message: 'bad' }, logs: [], elapsedMs: 1 } satisfies PluginRunResult)
      .mockResolvedValueOnce({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(h.feedback.toFeedback).toHaveBeenCalledTimes(1);
    const secondCall = h.prompts.buildRepairMessages.mock.calls[1]!;
    expect(secondCall[2]).toMatchObject({ phase: 'runtime', ok: false });
  });

  it('用户验收反馈作为首轮输入（工件中心，会话无关）', async () => {
    const h = harness();
    await new PluginCodegenUseCase(h.options).run({
      ...baseReq,
      currentCode: 'function rank(x){ return x }',
      userFeedback: '排错了，同分先比胜局',
    });
    const firstCall = h.prompts.buildRepairMessages.mock.calls[0]!;
    expect(firstCall[0]).toBe('同分先比胜局');
    expect(firstCall[1]).toContain('function rank');
    expect(firstCall[2]).toBe('排错了，同分先比胜局');
  });

  it('每轮都重新校验代码（不只验第一轮）', async () => {
    const h = harness();
    h.runtime.run
      .mockResolvedValueOnce({ ok: false, phase: 'compile', error: { name: 'SyntaxError', message: 'x' }, logs: [], elapsedMs: 1 } satisfies PluginRunResult)
      .mockResolvedValueOnce({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(h.validator.validate).toHaveBeenCalledTimes(2);
    expect(h.runtime.run).toHaveBeenCalledTimes(2);
  });

  it('校验失败不进入沙箱，直接生成反馈', async () => {
    const h = harness();
    h.validator.validate.mockReturnValueOnce({ ok: false, reason: '含 fetch' });
    h.runtime.run.mockResolvedValue({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(h.runtime.run).toHaveBeenCalledTimes(1);
    expect(h.feedback.toFeedback).not.toHaveBeenCalled();
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
    h.gateway.execute.mockResolvedValue({ text: '```js\n' + goodCode + '\n```', truncated: false });
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(goodCode);
  });

  it('模型直接输出纯 JS 源码时无需任何动作协议即可通过', async () => {
    const h = harness();
    h.protocol.parse.mockReturnValue({ ok: false, reason: '未找到合法 JSON 对象' });
    h.gateway.execute.mockResolvedValue({ text: goodCode, truncated: false });
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(goodCode);
  });

  it('协议因 plugin.revise 缺 artifactId 失败时仍能抢救 action.code（不再废掉整轮）', async () => {
    const h = harness();
    h.protocol.parse.mockReturnValue({ ok: false, reason: 'plugin.revise 必须提供 artifactId' });
    h.gateway.execute.mockResolvedValue({
      text: JSON.stringify({ reply: '修订好了', action: { kind: 'plugin.revise', code: goodCode } }),
      truncated: false,
    });
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(goodCode);
  });

  it('只有解释文字时给出契约反馈并重试，且提示要求直接输出源码', async () => {
    const h = harness({ maxAttempts: 1 });
    h.protocol.parse.mockReturnValue({ ok: false, reason: '非法 JSON' });
    h.gateway.execute.mockResolvedValue({ text: '我只解释一下', truncated: false });
    const result = await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(result.ok).toBe(false);
    expect(result.lastFeedback?.error?.name).toBe('ProtocolError');
    expect(result.lastFeedback?.hint).toContain('function rank(input)');
    expect(result.lastFeedback?.hint).toContain('不要 JSON 动作协议');
    expect(h.runtime.run).not.toHaveBeenCalled();
  });

  it('输出契约失败时把试算输入形状与真实选手清单回喂给下一轮', async () => {
    const h = harness();
    h.runtime.run
      .mockResolvedValueOnce({ ok: true, output: [{ id: 1, rank: 1 }], logs: [], elapsedMs: 1 } satisfies PluginRunResult)
      .mockResolvedValueOnce({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
    await new PluginCodegenUseCase(h.options).run(baseReq);
    const secondCall = h.prompts.buildRepairMessages.mock.calls[1]!;
    const fb = secondCall[2] as RepairFeedback;
    expect(fb.hint).toContain('matches 共 6 场');
    expect(fb.hint).toContain('1:甲');
    expect(fb.hint).toContain('2:乙');
    expect(fb.hint).toContain('3:丙');
    expect(fb.hint).toContain('id=0');
  });

  it('沙箱抛异常被当作可恢复失败而非整个循环崩溃', async () => {
    const h = harness();
    h.runtime.run.mockRejectedValueOnce(new Error('worker died'));
    h.runtime.run.mockResolvedValueOnce({ ok: true, output: validOutput, logs: [], elapsedMs: 1 } satisfies PluginRunResult);
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
    expect(h.runtime.run).toHaveBeenCalledWith(goodCode, SAMPLE_RANKING_INPUT, customSpec);
    expect(h.validator.validate).toHaveBeenCalledWith(goodCode, customSpec);
  });

  // ---------- 修订标准范式：四元分离 / 指令保真 / 显式变更 / verifier ----------
  const changedCode = 'function rank(input){ return { columns:[{key:"score",label:"积分"}], rows:[], fixed:true } }';
  const changedCode2 = 'function rank(input){ return { columns:[{key:"score",label:"积分"}], rows:[], fixed:2 } }';
  const revision = {
    intent: '原始需求：按积分排名',
    currentCode: goodCode,
    revisionRequest: '不对，总分不该是积分加对手分，请按积分编排制重算',
  };

  it('修订时指令原样透传 buildRepairMessages（第 5 参），且与 intent 分离', async () => {
    const h = harness();
    const codegen = new PluginCodegenUseCase(h.options);
    // 修订：让模型输出与 currentCode 不同的代码，保证能走到通过
    h.gateway.execute.mockResolvedValue({ text: '```js\n' + changedCode + '\n```', truncated: false });
    h.protocol.parse.mockReturnValue({ ok: false, reason: '纯源码' });
    await codegen.run(revision);
    const call = h.prompts.buildRepairMessages.mock.calls[0]!;
    expect(call[0]).toBe(revision.intent);           // spec
    expect(call[1]).toBe(goodCode);                   // state
    expect(call[4]).toBe(revision.revisionRequest);  // instruction 原样，未被 intent 覆盖
  });

  it('首次生成不调用 verifier（不多一次模型判定）', async () => {
    const h = harness();
    await new PluginCodegenUseCase(h.options).run(baseReq);
    expect(h.verifier.verify).not.toHaveBeenCalled();
  });

  it('修订且代码有改动时调用 verifier，并传入 spec/instruction/前后源码', async () => {
    const h = harness();
    h.gateway.execute.mockResolvedValue({ text: '```js\n' + changedCode + '\n```', truncated: false });
    h.protocol.parse.mockReturnValue({ ok: false, reason: '纯源码' });
    const result = await new PluginCodegenUseCase(h.options).run(revision);
    expect(result.ok).toBe(true);
    expect(h.verifier.verify).toHaveBeenCalledTimes(1);
    expect(h.verifier.verify).toHaveBeenCalledWith({
      spec: revision.intent,
      instruction: revision.revisionRequest,
      previousCode: goodCode,
      candidateCode: changedCode,
    });
    expect(result.trace.some((s) => s.phase === 'verify' && s.ok)).toBe(true);
  });

  it('修订时原样照抄当前源码 → diff 拦下、不进沙箱、回喂重改（核心：改不掉的根治）', async () => {
    const h = harness();
    // 模型每轮都返回当前源码（goodCode）—— 正是用户遇到「让它改它不改」
    h.gateway.execute.mockResolvedValue({ text: '```js\n' + goodCode + '\n```', truncated: false });
    h.protocol.parse.mockReturnValue({ ok: false, reason: '纯源码' });
    const result = await new PluginCodegenUseCase(h.options).run(revision);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(h.runtime.run).not.toHaveBeenCalled();       // 没改就不试算、不误判成功
    expect(h.verifier.verify).not.toHaveBeenCalled();
    expect(result.trace.filter((s) => s.phase === 'diff' && !s.ok)).toHaveLength(3);
    expect(result.lastFeedback?.error?.name).toBe('NoChangeError');
    expect(result.lastFeedback?.hint).toContain(revision.revisionRequest);
  });

  it('verifier 判「不满足」→ 回喂「还差什么」并进入下一轮', async () => {
    const h = harness();
    // 被回喂「还差什么」后，模型给出与上一轮不同的新版本（真实修订行为）
    h.gateway.execute
      .mockResolvedValueOnce({ text: '```js\n' + changedCode + '\n```', truncated: false })
      .mockResolvedValueOnce({ text: '```js\n' + changedCode2 + '\n```', truncated: false });
    h.protocol.parse.mockReturnValue({ ok: false, reason: '纯源码' });
    h.verifier.verify
      .mockResolvedValueOnce({ satisfied: false, reason: '仍把总分算成积分+对手分，没按编排制', available: true })
      .mockResolvedValueOnce({ satisfied: true, reason: '', available: true });
    const result = await new PluginCodegenUseCase(h.options).run(revision);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(h.verifier.verify).toHaveBeenCalledTimes(2);
    expect(result.trace.some((s) => s.phase === 'verify' && !s.ok)).toBe(true);
    // 回喂内容要能指导下一轮：带「还差什么」与本轮指令
    const secondCall = h.prompts.buildRepairMessages.mock.calls[1]!;
    const fb = secondCall[2] as RepairFeedback;
    expect(fb.error?.name).toBe('InstructionError');
    expect(fb.hint).toContain('没按编排制');
    expect(fb.hint).toContain(revision.revisionRequest);
    expect(secondCall[4]).toBe(revision.revisionRequest); // 每轮指令都在
  });

  it('verifier 自身不可用 → fail-open 不打回正确代码，但过程里显式记录「未判定」', async () => {
    const h = harness();
    h.gateway.execute.mockResolvedValue({ text: '```js\n' + changedCode + '\n```', truncated: false });
    h.protocol.parse.mockReturnValue({ ok: false, reason: '纯源码' });
    h.verifier.verify.mockResolvedValue({ satisfied: false, available: false, reason: '验证器调用失败（不据此打回）' });
    const result = await new PluginCodegenUseCase(h.options).run(revision);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.trace.some((s) => s.phase === 'verify' && !s.ok)).toBe(true);
  });

  it('未注入 verifier 时修订退化为轻量档：diff 仍拦得住原样照抄', async () => {
    const h = harness();
    delete (h.options as { verifier?: unknown }).verifier;
    h.gateway.execute.mockResolvedValue({ text: '```js\n' + goodCode + '\n```', truncated: false });
    h.protocol.parse.mockReturnValue({ ok: false, reason: '纯源码' });
    const result = await new PluginCodegenUseCase(h.options).run(revision);
    expect(result.ok).toBe(false);
    expect(result.trace.some((s) => s.phase === 'diff')).toBe(true);
  });

  it('修订多轮又绕回原始代码 → 相对 baseCode 的净改动检测同样拦下', async () => {
    const h = harness();
    // 第 1 轮给出改动，verifier 判不满足；第 2 轮改回原始 goodCode → 被 sameAsBase 拦；
    // 第 3 轮仍照抄 goodCode → 继续被拦
    h.gateway.execute
      .mockResolvedValueOnce({ text: '```js\n' + changedCode + '\n```', truncated: false })
      .mockResolvedValueOnce({ text: '```js\n' + goodCode + '\n```', truncated: false })
      .mockResolvedValueOnce({ text: '```js\n' + goodCode + '\n```', truncated: false });
    h.protocol.parse.mockReturnValue({ ok: false, reason: '纯源码' });
    h.verifier.verify.mockResolvedValueOnce({ satisfied: false, reason: '还差点', available: true });
    const result = await new PluginCodegenUseCase(h.options).run(revision);
    expect(result.trace.some((s) => s.phase === 'diff' && !s.ok)).toBe(true);
    expect(result.ok).toBe(false);
  });
});
