/**
 * 插件系统装配根测试
 *
 * 验证：
 * - 内存存储 + mock 运行时可完整装配
 * - **会话清空后工件仍可读可改**（工件中心最核心的验收点）
 * - 排名插件启用时覆盖内置结果，失败/未启用时回落
 * - 可配置修复轮数被正确传递给各层
 * - safeReply 防注入
 */

import { describe, it, expect, vi } from 'vitest';
import { createPluginSystem, loadPluginMaxAttempts, savePluginMaxAttempts, DEFAULT_PLUGIN_MAX_ATTEMPTS } from '../PluginSystem';
import { resetPluginMaxAttemptsForTest } from '../PluginConfig';
import { InMemoryPluginArtifactStore } from '@infrastructure/plugin/InMemoryPluginArtifactStore';
import type { IModelGateway, ModelRequest, ModelResult } from '@application/model/IModelGateway';
import type { IPluginRuntime, PluginRunResult, PluginArtifact } from '@domain/plugin/types';
import type { RankingResult } from '@domain/ranking/types';
import { RANKING_SPEC } from '@domain/plugin/types';

function gateway(): IModelGateway {
  return {
    isReady: () => true,
    execute: async (_req: ModelRequest): Promise<ModelResult> => ({ text: '{"reply":"好","action":{"kind":"none"}}', truncated: false }),
  };
}

function runtime(result: PluginRunResult): IPluginRuntime {
  return { run: vi.fn().mockResolvedValue(result), dispose: vi.fn() };
}

const ok = (output: unknown): PluginRunResult => ({ ok: true, output, logs: [], elapsedMs: 1 });

function builtin(): RankingResult {
  return {
    totalRounds: 3, completedRounds: 3,
    rankings: [
      { id: 1, name: 'A', rank: 1, score: 6, opponentScore: 10, progressiveScore: 12, reverseMinus: [], reverseMinusDisplay: '', wins: 3, losses: 0, draws: 0 },
      { id: 2, name: 'B', rank: 2, score: 4, opponentScore: 9, progressiveScore: 10, reverseMinus: [], reverseMinusDisplay: '', wins: 2, losses: 1, draws: 0 },
    ],
  };
}

function sys(overrides: Parameters<typeof createPluginSystem>[0] = {}) {
  return createPluginSystem({
    gateway: gateway(),
    useMemoryStore: true,
    runtime: runtime(ok([])),
    ...overrides,
  });
}

describe('createPluginSystem', () => {
  it('完整装配出 agent / codegen / artifacts / snapshot', async () => {
    const s = await sys();
    expect(s.agent).toBeDefined();
    expect(s.codegen).toBeDefined();
    expect(s.artifacts).toBeDefined();
    expect(s.snapshot).toBeDefined();
    expect(s.maxAttempts).toBe(DEFAULT_PLUGIN_MAX_ATTEMPTS);
    await s.dispose();
  });

  it('可配置修复轮数', async () => {
    const s = await sys({ maxAttempts: 5 });
    expect(s.maxAttempts).toBe(5);
    await s.dispose();
  });

  it('工件中心：会话清空（换 store 实例 + 共享持久化）后仍可读可改', async () => {
    const persistence = new Map<string, string>();
    const store = new InMemoryPluginArtifactStore(persistence);
    const s1 = await sys({ store });

    const created = await s1.artifacts.create({
      name: '同分比胜局', intent: '同分先看胜局数', code: 'function rank(p){ return p }',
      pointId: 'ranking.tiebreak', origin: 'llm', spec: RANKING_SPEC,
    });
    expect(created.enabled).toBe(false); // 人工闸门

    // 模拟「会话没了」：丢掉整个 PluginSystem 与 store 实例，只用持久化数据重建
    const store2 = new InMemoryPluginArtifactStore(persistence);
    const s2 = await sys({ store: store2 });
    const loaded = await s2.artifacts.get(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.intent).toBe('同分先看胜局数');
    expect(loaded!.code).toBe('function rank(p){ return p }');

    // 仍能修订，且 intent/spec 不丢
    const revised = await s2.artifacts.revise(created.id, {
      code: 'function rank(p){ return p.slice().reverse() }',
      trigger: 'user-feedback', feedback: '排反了',
    });
    expect(revised.version).toBe(2);
    expect(revised.intent).toBe('同分先看胜局数');
    expect(revised.spec.pointId).toBe('ranking.tiebreak');
    expect(revised.history).toHaveLength(2);
    await s1.dispose();
    await s2.dispose();
  });

  it('snapshot 不含 code，但 withCode 可按需展开', async () => {
    const s = await sys();
    const a = await s.artifacts.create({
      name: '规则', intent: '需求', code: 'function rank(p){ return p }',
      pointId: 'ranking.tiebreak', origin: 'llm', spec: RANKING_SPEC,
    });
    const snap = await s.snapshot.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.id).toBe(a.id);
    expect('code' in snap[0]!).toBe(false);
    const withCode = await s.snapshot.withCode(a.id);
    expect(withCode?.code).toBe('function rank(p){ return p }');
    await s.dispose();
  });

  it('没有启用插件时排名回落内置结果', async () => {
    const s = await sys();
    await s.artifacts.create({
      name: '停用', intent: 'x', code: 'function rank(p){ return p }',
      pointId: 'ranking.tiebreak', origin: 'llm', spec: RANKING_SPEC,
    });
    const b = builtin();
    await expect(s.applyRanking(b)).resolves.toEqual(b);
    await s.dispose();
  });

  it('启用插件后按插件结果覆盖排名', async () => {
    const s = await sys({
      runtime: runtime(ok([{ id: 2, rank: 1 }, { id: 1, rank: 2 }])),
    });
    const a = await s.artifacts.create({
      name: '规则', intent: 'x', code: 'function rank(p){ return p }',
      pointId: 'ranking.tiebreak', origin: 'llm', spec: RANKING_SPEC,
    });
    await s.artifacts.setEnabled(a.id, true);
    const result = await s.applyRanking(builtin());
    expect(result.rankings.map((p) => p.id)).toEqual([2, 1]);
    await s.dispose();
  });

  it('插件执行失败时回落内置结果，不抛错', async () => {
    const s = await sys({
      runtime: runtime({ ok: false, phase: 'runtime', error: { name: 'E', message: 'x' }, logs: [], elapsedMs: 1 }),
    });
    const a = await s.artifacts.create({
      name: '坏插件', intent: 'x', code: 'function rank(p){ throw new Error("x") }',
      pointId: 'ranking.tiebreak', origin: 'llm', spec: RANKING_SPEC,
    });
    await s.artifacts.setEnabled(a.id, true);
    const b = builtin();
    await expect(s.applyRanking(b)).resolves.toEqual(b);
    await s.dispose();
  });

  it('safeReply 转义 HTML', async () => {
    const s = await sys();
    expect(s.safeReply('<script>alert(1)</script>')).not.toContain('<script>');
    await s.dispose();
  });
});

describe('可配置轮数持久化', () => {
  it('默认 3，保存后可读取，越界收敛', () => {
    resetPluginMaxAttemptsForTest();
    expect(DEFAULT_PLUGIN_MAX_ATTEMPTS).toBe(3);
    savePluginMaxAttempts(5);
    expect(loadPluginMaxAttempts()).toBe(5);
    savePluginMaxAttempts(99);
    expect(loadPluginMaxAttempts()).toBe(10);
    savePluginMaxAttempts(0);
    expect(loadPluginMaxAttempts()).toBe(1);
    savePluginMaxAttempts(3);
    resetPluginMaxAttemptsForTest();
  });

  it('非法存储值 / 无 localStorage 时回落默认值（不抛错）', () => {
    resetPluginMaxAttemptsForTest();
    // Node 环境没有 localStorage：读写走内存兜底，仍然自洽
    expect(loadPluginMaxAttempts()).toBe(3);
    savePluginMaxAttempts(7);
    expect(loadPluginMaxAttempts()).toBe(7);
    resetPluginMaxAttemptsForTest();
    expect(loadPluginMaxAttempts()).toBe(3);
  });

  it('localStorage 被污染时回落默认值', () => {
    // 真实污染场景：模拟浏览器里被写入非数字值。
    // 装一个最小 localStorage stub，验证 load 走 getItem -> normalize 的回落分支。
    const store = new Map<string, string>();
    const stub = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
    try {
      resetPluginMaxAttemptsForTest();
      stub.setItem('weiqi.plugin.maxAttempts', 'abc');
      expect(loadPluginMaxAttempts()).toBe(DEFAULT_PLUGIN_MAX_ATTEMPTS);
      stub.setItem('weiqi.plugin.maxAttempts', '99');
      expect(loadPluginMaxAttempts()).toBe(10);
      stub.setItem('weiqi.plugin.maxAttempts', '0');
      expect(loadPluginMaxAttempts()).toBe(1);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
      resetPluginMaxAttemptsForTest();
    }
  });
});
