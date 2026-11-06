import { describe, it, expect } from 'vitest';
import { isDebugTraceStep, visibleDebugSteps } from '../PluginTraceVisibility';
import type { PluginTraceStep } from '@domain/plugin/types';

const agent = (
  phase: string,
  extra: Partial<PluginTraceStep> = {},
): PluginTraceStep => ({
  source: 'agent', attempt: 1, phase, ok: true, detail: phase, ...extra,
});

const codegen = (
  phase: string,
  extra: Partial<PluginTraceStep> = {},
): PluginTraceStep => ({
  source: 'codegen', attempt: 1, phase, ok: true, detail: phase, ...extra,
});

describe('isDebugTraceStep — 过程块只在有插件代码/调试时出现', () => {
  it('codegen 全部步骤都算调试（产码 / 提取 / 校验 / 试算 / 修复）', () => {
    for (const phase of ['llm', 'protocol', 'contract', 'validate', 'sandbox', 'crash']) {
      expect(isDebugTraceStep(codegen(phase)), phase).toBe(true);
    }
    // 失败的修复轮同样要展示
    expect(isDebugTraceStep(codegen('sandbox', { ok: false }))).toBe(true);
  });

  it('agent 的编排/回复步骤不算调试', () => {
    for (const phase of ['decision', 'observe', 'final', 'protocol']) {
      expect(isDebugTraceStep(agent(phase)), phase).toBe(false);
    }
  });

  it('agent 侧实质的代码校验/崩溃/试算仍算调试', () => {
    for (const phase of ['validate', 'crash', 'sandbox']) {
      expect(isDebugTraceStep(agent(phase)), phase).toBe(true);
    }
  });

  it('任一带完整源码的步骤都算调试，空白 code 不算', () => {
    expect(isDebugTraceStep(agent('observe', { code: 'function rank(p){return p}' }))).toBe(true);
    expect(isDebugTraceStep(agent('observe', { code: '   ' }))).toBe(false);
    expect(isDebugTraceStep(agent('observe', { code: '' }))).toBe(false);
  });
});

describe('visibleDebugSteps', () => {
  it('按原顺序保留可见步骤，丢弃编排步骤', () => {
    const decision = agent('decision');
    const llm = codegen('llm', { code: 'function rank(p){return p}' });
    const observe = agent('observe');
    const sandbox = codegen('sandbox');
    const final = agent('final');
    expect(visibleDebugSteps([decision, llm, observe, sandbox, final])).toEqual([llm, sandbox]);
  });

  it('能力询问（只有 decision + final）过滤后为空 → 不建过程块', () => {
    expect(visibleDebugSteps([agent('decision'), agent('final')])).toEqual([]);
  });

  it('查看清单 / 查看源码（decision + observe）过滤后为空', () => {
    expect(visibleDebugSteps([agent('decision'), agent('observe'), agent('final')])).toEqual([]);
  });

  it('undefined / 空数组返回空', () => {
    expect(visibleDebugSteps(undefined)).toEqual([]);
    expect(visibleDebugSteps([])).toEqual([]);
  });
});
