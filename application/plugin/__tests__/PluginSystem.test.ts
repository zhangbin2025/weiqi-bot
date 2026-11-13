/**
 * 插件系统装配根测试
 *
 * 验证：
 * - 内存存储 + mock 运行时可完整装配
 * - **会话清空后工件仍可读可改**（工件中心最核心的验收点）
 * - applyRanking 是唯一管线：未选插件走内置、显式选中已启用插件才进沙箱，
 *   失败/未启用/不存在一律回落内置结果（但都是 computeRanking 新产的 RankingTable）
 * - 可配置修复轮数被正确传递给各层
 * - safeReply 防注入
 */

import { describe, it, expect, vi } from 'vitest';
import { createPluginSystem, loadPluginMaxAttempts, savePluginMaxAttempts, DEFAULT_PLUGIN_MAX_ATTEMPTS } from '../PluginSystem';
import { resetPluginMaxAttemptsForTest } from '../PluginConfig';
import { InMemoryPluginArtifactStore } from '@infrastructure/plugin/InMemoryPluginArtifactStore';
import type { IModelGateway, ModelRequest, ModelResult } from '@application/model/IModelGateway';
import type { IPluginRuntime, PluginRunResult } from '@domain/plugin/types';
import type { MatchData } from '@domain/ranking/types';
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

/** 原始对阵表（唯一数据源）：3 轮、3 名选手 + 一个轮空位 */
const matches: MatchData[] = [
  { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
  { bout: 1, p1Id: 3, p1Name: 'C', p1Score: 2, p2Id: 0, p2Name: '', p2Score: 0 },
  { bout: 2, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 3, p2Name: 'C', p2Score: 0 },
  { bout: 2, p1Id: 2, p1Name: 'B', p1Score: 2, p2Id: 0, p2Name: '', p2Score: 0 },
  { bout: 3, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
];

/** 插件的合法输出：自定义一列「胜局数」，rows 覆盖全部 3 人 */
function pluginOutput(): unknown {
  return {
    columns: [{ key: 'myWins', label: '胜局数' }],
    rows: [
      { id: 1, name: 'A', rank: 1, cells: { myWins: 3 } },
      { id: 2, name: 'B', rank: 2, cells: { myWins: 1 } },
      { id: 3, name: 'C', rank: 3, cells: { myWins: 1 } },
    ],
  };
}

function sys(overrides: Parameters<typeof createPluginSystem>[0] = {}) {
  return createPluginSystem({
    gateway: gateway(),
    useMemoryStore: true,
    runtime: runtime(ok(pluginOutput())),
    ...overrides,
  });
}

/** 内置结果的列标签（mode=default） */
const BUILTIN_LABELS = ['积分', '对手分', '累进分', '逆减'];

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
      pointId: 'ranking', origin: 'llm', spec: RANKING_SPEC,
    });
    expect(created.enabled).toBe(false); // 人工闸门

    const store2 = new InMemoryPluginArtifactStore(persistence);
    const s2 = await sys({ store: store2 });
    const loaded = await s2.artifacts.get(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.intent).toBe('同分先看胜局数');
    expect(loaded!.code).toBe('function rank(p){ return p }');

    const revised = await s2.artifacts.revise(created.id, {
      code: 'function rank(p){ return p }',
      trigger: 'user-feedback', feedback: '排反了',
    });
    expect(revised.version).toBe(2);
    expect(revised.intent).toBe('同分先看胜局数');
    expect(revised.spec.pointId).toBe('ranking');
    expect(revised.history).toHaveLength(2);
    await s1.dispose();
    await s2.dispose();
  });

  it('snapshot 不含 code，但 withCode 可按需展开', async () => {
    const s = await sys();
    const a = await s.artifacts.create({
      name: '规则', intent: '需求', code: 'function rank(p){ return p }',
      pointId: 'ranking', origin: 'llm', spec: RANKING_SPEC,
    });
    const snap = await s.snapshot.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.id).toBe(a.id);
    expect('code' in snap[0]!).toBe(false);
    const withCode = await s.snapshot.withCode(a.id);
    expect(withCode?.code).toBe('function rank(p){ return p }');
    await s.dispose();
  });

  it('默认不传 selectedArtifactId：即使有已启用插件也走内置（不加载 wasm/Worker）', async () => {
    const s = await sys();
    const a = await s.artifacts.create({
      name: '规则', intent: 'x', code: 'function rank(p){ return p }',
      pointId: 'ranking', origin: 'llm', spec: RANKING_SPEC,
    });
    await s.artifacts.setEnabled(a.id, true);
    const table = await s.applyRanking(matches);
    expect(table.columns.map((c) => c.label)).toEqual(BUILTIN_LABELS);
    expect(table.rows).toHaveLength(3);
    expect(s.runtime.run).not.toHaveBeenCalled();
    expect(table.totalRounds).toBe(3);
    expect(table.completedRounds).toBe(3);
    await s.dispose();
  });

  it('显式选中已启用插件：插件从原始对阵自己算出全部列（不再叠加内置）', async () => {
    const s = await sys();
    const a = await s.artifacts.create({
      name: '规则', intent: 'x', code: 'function rank(p){ return p }',
      pointId: 'ranking', origin: 'llm', spec: RANKING_SPEC,
    });
    await s.artifacts.setEnabled(a.id, true);
    const table = await s.applyRanking(matches, a.id);
    expect(table.columns.map((c) => c.label)).toEqual(['胜局数']);
    expect(table.rows[0]!.cells['myWins']).toBe(3);
    // 传给沙箱的是原始对阵（不是内置排名结果）
    const passed = (s.runtime.run as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(passed).toEqual({ matches });
    await s.dispose();
  });

  it('选中未启用的插件：回落内置（人工闸门不可绕过）', async () => {
    const s = await sys();
    const a = await s.artifacts.create({
      name: '停用', intent: 'x', code: 'function rank(p){ return p }',
      pointId: 'ranking', origin: 'llm', spec: RANKING_SPEC,
    });
    const table = await s.applyRanking(matches, a.id);
    expect(table.columns.map((c) => c.label)).toEqual(BUILTIN_LABELS);
    expect(s.runtime.run).not.toHaveBeenCalled();
    await s.dispose();
  });

  it('选中不存在的 id / 扩展点不匹配的插件：回落内置', async () => {
    const s = await sys();
    expect((await s.applyRanking(matches, 'plugin:missing')).columns.map((c) => c.label)).toEqual(BUILTIN_LABELS);
    const wrong = await s.artifacts.create({
      name: '别的扩展点', intent: 'x', code: 'function rank(p){ return p }',
      pointId: 'other.point', origin: 'llm', spec: { ...RANKING_SPEC, pointId: 'other.point' },
    });
    await s.artifacts.setEnabled(wrong.id, true);
    expect((await s.applyRanking(matches, wrong.id)).columns.map((c) => c.label)).toEqual(BUILTIN_LABELS);
    await s.dispose();
  });

  it('插件执行失败 / 输出不合契约：回落内置结果，不抛错', async () => {
    for (const bad of [
      { ok: false, phase: 'runtime', error: { name: 'E', message: 'x' }, logs: [], elapsedMs: 1 } as PluginRunResult,
      ok({ foo: 1 }), // 结构不符 → computeRanking 抛 RankingContractError
    ]) {
      const s = await sys({ runtime: runtime(bad) });
      const a = await s.artifacts.create({
        name: '坏插件', intent: 'x', code: 'function rank(p){ throw new Error("x") }',
        pointId: 'ranking', origin: 'llm', spec: RANKING_SPEC,
      });
      await s.artifacts.setEnabled(a.id, true);
      const table = await s.applyRanking(matches, a.id);
      expect(table.columns.map((c) => c.label)).toEqual(BUILTIN_LABELS);
      await s.dispose();
    }
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
    expect(loadPluginMaxAttempts()).toBe(3);
    savePluginMaxAttempts(7);
    expect(loadPluginMaxAttempts()).toBe(7);
    resetPluginMaxAttemptsForTest();
    expect(loadPluginMaxAttempts()).toBe(3);
  });

  it('localStorage 被污染时回落默认值', () => {
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
