import { describe, it, expect } from 'vitest';
import { toFeedback, sanitizeFeedback, describeInputShape } from '../FeedbackPack';
import type { PluginRunResult, RepairFeedback } from '@domain/plugin/types';

const failure = (overrides?: Partial<Extract<PluginRunResult, { ok: false }>>): Extract<PluginRunResult, { ok: false }> => ({
  ok: false,
  phase: 'runtime',
  error: { name: 'TypeError', message: 'cannot read wins of undefined', stack: 'at rank (plugin.js:3:10)\n  at main' },
  logs: [],
  elapsedMs: 12,
  ...overrides,
});

describe('describeInputShape', () => {
  it('只给字段与长度，不含真实姓名 / id 值', () => {
    const s = describeInputShape([
      { id: 88213, name: '柯洁', score: 12.5 },
      { id: 99120, name: '申真谞', score: 11 },
    ]);
    expect(s).toContain('Array<2item>');
    expect(s).toContain('id');
    expect(s).toContain('name');
    expect(s).toContain('score');
    expect(s).not.toContain('柯洁');
    expect(s).not.toContain('88213');
  });

  it('标量数组 / 对象 / 原始值 / null / undefined', () => {
    expect(describeInputShape([1, 2, 3])).toContain('Array<3item>');
    expect(describeInputShape({ a: 1, b: 2 })).toBe('Object{a,b}');
    expect(describeInputShape('abc')).toBe('string');
    expect(describeInputShape(42)).toBe('number');
    expect(describeInputShape(null)).toBe('null');
    expect(describeInputShape(undefined)).toBe('undefined');
  });

  it('空数组不泄漏', () => {
    expect(describeInputShape([])).toContain('Array<0item>');
  });
});

describe('toFeedback', () => {
  it('保留错误、阶段、轮次，并生成人话 hint', () => {
    const fb = toFeedback(failure(), 1, 3, 'Array<3item> of {id,name}');
    expect(fb.phase).toBe('runtime');
    expect(fb.ok).toBe(false);
    expect(fb.attempt).toBe(1);
    expect(fb.maxAttempts).toBe(3);
    expect(fb.error?.name).toBe('TypeError');
    expect(fb.inputShape).toContain('Array<3item>');
    expect(fb.hint).toContain('运行时');
  });

  it('各阶段都有对应 hint', () => {
    for (const phase of ['compile', 'runtime', 'contract', 'timeout', 'oom', 'crash', 'user'] as const) {
      const fb = toFeedback(failure({ phase }), 1, 3);
      expect(fb.hint && fb.hint.length).toBeGreaterThan(4);
    }
  });

  it('contract 阶段把缺失字段写进 hint', () => {
    const fb = toFeedback(failure({ phase: 'contract', contract: { entryFound: false, outputIsArray: true, missingFields: ['rank'] } }), 2, 3);
    expect(fb.contract?.missingFields).toContain('rank');
    expect(fb.hint).toContain('rank');
  });

  it('沙箱已给 hint 时优先沿用', () => {
    const fb = toFeedback(failure({ hint: '沙箱自定义提示' }), 1, 3);
    expect(fb.hint).toBe('沙箱自定义提示');
  });

  it('成功结果也产出合法反馈包（不崩）', () => {
    const fb = toFeedback({ ok: true, output: [], logs: [], elapsedMs: 1 }, 1, 3);
    expect(fb.ok).toBe(false);
    expect(fb.attempt).toBe(1);
  });

  it('不把原始输入值塞进反馈（工件中心 + 脱敏前提）', () => {
    const fb = toFeedback(failure({ error: { name: 'E', message: '柯洁 88213 出错' } }), 1, 3);
    // toFeedback 本身不脱敏，但绝不额外注入输入值；脱敏由 sanitizeFeedback 负责
    expect(JSON.stringify(fb)).not.toContain('Array<');
  });
});

describe('sanitizeFeedback', () => {
  const base: RepairFeedback = {
    phase: 'runtime', ok: false,
    error: {
      name: 'TypeError',
      message: 'user 882137491 柯洁 score=1234567890123 出错 ' + 'x'.repeat(500),
      stack: 'at rank (plugin.js:3:10)\n' + 'y'.repeat(1000) + ' token=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
      lineNumber: 3,
    },
    hint: '检查字段',
    userText: '第二行 882137491 排错了',
    attempt: 1, maxAttempts: 3,
  };

  it('stack 截短、message 截短、总长度受控', () => {
    const s = sanitizeFeedback(base, 600);
    expect(JSON.stringify(s).length).toBeLessThanOrEqual(600);
    expect(s.error!.stack!.length).toBeLessThanOrEqual(400);
    expect(s.error!.message.length).toBeLessThanOrEqual(300);
  });

  it('移出行内长数字串与长 token（脱敏）', () => {
    const s = sanitizeFeedback(base, 2000);
    expect(s.error!.message).not.toContain('1234567890123');
    expect(s.error!.message).not.toContain('882137491');
    expect(s.error!.stack!).not.toContain('YWJjZGVmZ2hpamts');
    expect(s.error!.message).toContain('[n]');
    expect(s.userText).not.toContain('882137491');
  });

  it('保留 lineNumber 与 phase / attempt / maxAttempts', () => {
    const s = sanitizeFeedback(base, 2000);
    expect(s.error?.lineNumber).toBe(3);
    expect(s.phase).toBe('runtime');
    expect(s.attempt).toBe(1);
    expect(s.maxAttempts).toBe(3);
  });

  it('不修改入参', () => {
    const copy = JSON.stringify(base);
    sanitizeFeedback(base, 300);
    expect(JSON.stringify(base)).toBe(copy);
  });

  it('极小预算下逐项裁掉非关键字段，仍保持合法', () => {
    const s = sanitizeFeedback(base, 200);
    expect(JSON.stringify(s).length).toBeLessThanOrEqual(200);
    expect(s.ok).toBe(false);
    expect(s.attempt).toBe(1);
  });

  it('contract.missingFields 被限制长度', () => {
    const fb: RepairFeedback = {
      ...base,
      contract: { entryFound: false, outputIsArray: true, missingFields: Array.from({ length: 50 }, (_, i) => `f${i}`) },
    };
    expect(sanitizeFeedback(fb, 2000).contract!.missingFields).toHaveLength(12);
  });

  it('无 error 时不凭空造字段', () => {
    const fb: RepairFeedback = { phase: 'timeout', ok: false, attempt: 2, maxAttempts: 3, hint: '超时' };
    const s = sanitizeFeedback(fb);
    expect(s.error).toBeUndefined();
    expect(s.hint).toBe('超时');
  });

  it('默认 maxChars 生效', () => {
    const s = sanitizeFeedback(base);
    expect(JSON.stringify(s).length).toBeLessThanOrEqual(1200);
  });
});
