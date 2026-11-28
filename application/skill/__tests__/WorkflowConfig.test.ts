/**
 * WorkflowConfig 持久化与回退契约。
 *
 * 用可注入的 Storage 桩（node 测试环境无 localStorage）验证：
 * - 默认是有限正整数（经验值），不是「不限制」；
 * - off / 正整数正常读写；
 * - 非法持久化值回退到内存合法值，再回退到默认经验值，绝不被坏 storage 改成 null；
 * - resetWorkflowLimitsForTest 清干净内存与持久化，避免用例互相污染。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadWorkflowLimits,
  saveWorkflowLimit,
  resetWorkflowLimitsForTest,
} from '../WorkflowConfig';

const STORAGE_KEYS = {
  maxIterationsPerLoop: 'weiqi.workflow.maxIterationsPerLoop',
  maxTotalIterations: 'weiqi.workflow.maxTotalIterations',
  maxNestingDepth: 'weiqi.workflow.maxNestingDepth',
} as const;

function installStorageStub(): Map<string, string> {
  const data = new Map<string, string>();
  const stub = {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { data.set(k, v); }),
    removeItem: vi.fn((k: string) => { data.delete(k); }),
    clear: vi.fn(() => data.clear()),
    key: vi.fn(),
    length: 0,
  } as unknown as Storage;
  vi.stubGlobal('localStorage', stub);
  return data;
}

describe('WorkflowConfig — 默认有限经验值', () => {
  beforeEach(() => { installStorageStub(); resetWorkflowLimitsForTest(); });
  afterEach(() => { resetWorkflowLimitsForTest(); vi.unstubAllGlobals(); });

  it('三项默认都是有限正整数，且互不相同语义明确', () => {
    const limits = loadWorkflowLimits();
    for (const key of Object.keys(STORAGE_KEYS) as (keyof typeof STORAGE_KEYS)[]) {
      expect(Number.isSafeInteger(limits[key])).toBe(true);
      expect(limits[key]!).toBeGreaterThan(0);
    }
    // 累计预算 > 单循环预算：与旧 Runner 的 500 > 100 一致（经验值，未重新调参）
    expect(limits.maxTotalIterations!).toBeGreaterThan(limits.maxIterationsPerLoop!);
  });

  it('正整数 / off 双向读写，且各 key 独立', () => {
    saveWorkflowLimit('maxIterationsPerLoop', 250);
    saveWorkflowLimit('maxTotalIterations', null);
    saveWorkflowLimit('maxNestingDepth', 64);
    expect(loadWorkflowLimits()).toEqual({
      maxIterationsPerLoop: 250,
      maxTotalIterations: null,
      maxNestingDepth: 64,
    });
  });
});

describe('WorkflowConfig — 非法持久化值回退', () => {
  beforeEach(() => { installStorageStub(); resetWorkflowLimitsForTest(); });
  afterEach(() => { resetWorkflowLimitsForTest(); vi.unstubAllGlobals(); });

  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', 'abc', ''])('%s 回退到内存合法值，不变成 off', (bad) => {
    saveWorkflowLimit('maxIterationsPerLoop', 37);
    const s = globalThis.localStorage;
    s.setItem(STORAGE_KEYS.maxIterationsPerLoop, bad);
    expect(loadWorkflowLimits().maxIterationsPerLoop).toBe(37);
  });

  it('无内存合法值时坏 storage 回退到默认经验值（有限正整数）', () => {
    const s = globalThis.localStorage;
    s.setItem(STORAGE_KEYS.maxTotalIterations, 'corrupted');
    const value = loadWorkflowLimits().maxTotalIterations;
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(value!).toBeGreaterThan(0);
  });

  it('写 storage 失败（隐私模式）时内存值仍生效', () => {
    const s = globalThis.localStorage;
    vi.spyOn(s, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    saveWorkflowLimit('maxNestingDepth', 42);
    expect(loadWorkflowLimits().maxNestingDepth).toBe(42);
    // 读路径同样要能容错：getItem 抛错时回退内存值
    vi.spyOn(s, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadWorkflowLimits().maxNestingDepth).toBe(42);
  });
});
