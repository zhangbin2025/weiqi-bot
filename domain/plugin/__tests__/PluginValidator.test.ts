import { describe, it, expect } from 'vitest';
import { PluginValidator, validatePluginOutput, contractCheckHint } from '../PluginValidator';
import { RANKING_SPEC, type PluginSpec } from '@domain/plugin/types';

const validator = new PluginValidator();
const spec = (overrides?: Partial<PluginSpec>): PluginSpec => ({
  ...RANKING_SPEC,
  ...overrides,
  limits: { ...RANKING_SPEC.limits, ...overrides?.limits },
});

const good = 'function rank(players){ return players.map((p,i)=>({id:p.id, rank:i+1})) }';

describe('PluginValidator.validate', () => {
  it('正常纯计算代码通过', () => {
    expect(validator.validate(good, spec())).toEqual({ ok: true });
  });

  it('空代码 / 全空白被拒', () => {
    for (const c of ['', '   \n\t  ']) {
      const r = validator.validate(c, spec());
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('空');
    }
  });

  it('非字符串输入被拒', () => {
    expect(validator.validate(undefined as unknown as string, spec()).ok).toBe(false);
  });

  it('超过 maxCodeBytes 被拒（按 UTF-8 字节算，中文也算）', () => {
    const tiny = spec({ limits: { ...RANKING_SPEC.limits, maxCodeBytes: 20 } });
    expect(validator.validate('x'.repeat(21), tiny).ok).toBe(false);
    expect(validator.validate('x'.repeat(21), tiny).reason).toContain('超过上限');
    // 中文 3 字节/字
    expect(validator.validate('一'.repeat(10), tiny).ok).toBe(false);
  });

  it.each([
    ['fetch(', 'fetch'],
    ['window.x', 'window'],
    ['document.body', 'document'],
    ['localStorage.getItem', 'localStorage'],
    ['indexedDB.open', 'indexedDB'],
    ['new XMLHttpRequest()', 'XMLHttpRequest'],
    ['importScripts("a")', 'importScripts'],
    ['require("fs")', 'require'],
    ['postMessage(x)', 'postMessage'],
    ['self.x', 'self'],
    ['navigator.userAgent', 'navigator'],
    ['new WebSocket("ws://x")', 'WebSocket'],
  ])('拦截浏览器/宿主全局 %s', (code, token) => {
    const r = validator.validate(code, spec());
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(token);
  });

  it.each([
    ['eval("x")', 'eval'],
    ['new Function("return 1")', 'new Function'],
    ['import("fs")', 'import'],
    ['while(true){}', 'while(true)'],
    ['while ( true ) {}', 'while(true)'],
    ['for(;;){}', 'for(;;)'],
  ])('拦截高危模式 %s', (code, token) => {
    const r = validator.validate(code, spec());
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(token);
  });

  it('注释里出现 fetch 也会被预检拦下（快筛策略，符合预期）', () => {
    expect(validator.validate('// fetch is bad\n' + good, spec()).ok).toBe(false);
  });

  it('不误伤普通标识符（如 rank、players、fetchCount 里的 fetch 边界）', () => {
    // \bfetch\b 会命中 fetchCount 里的 fetch 吗？不会，因为后面是 C 属于单词字符
    expect(validator.validate('function rank(p){ const x = 1; return p }', spec()).ok).toBe(true);
  });
});

describe('validatePluginOutput', () => {
  it('结构正确的数组通过', () => {
    const check = validatePluginOutput([{ id: 1, rank: 1 }, { id: 2, rank: 2 }], spec());
    expect(check.outputIsArray).toBe(true);
    expect(check.entryFound).toBe(true);
    expect(check.missingFields).toEqual([]);
  });

  it('非数组 → outputIsArray=false', () => {
    const check = validatePluginOutput({ id: 1, rank: 1 }, spec());
    expect(check.outputIsArray).toBe(false);
    expect(contractCheckHint(check)).toContain('数组');
  });

  it('缺 rank / id → 汇总缺失字段', () => {
    const check = validatePluginOutput([{ id: 1 }], spec());
    expect(check.missingFields).toContain('rank');
    expect(check.missingFields).toContain('rank(number)');
    expect(check.entryFound).toBe(false);
  });

  it('rank 不是数值 → 标记 rank(number)', () => {
    const check = validatePluginOutput([{ id: 1, rank: '1' }], spec());
    expect(check.missingFields).toContain('rank(number)');
  });

  it('行是 null / 标量 → 缺全部字段', () => {
    const check = validatePluginOutput([null, 3], spec());
    expect(check.missingFields).toEqual(expect.arrayContaining(['rank', 'id']));
  });

  it('空数组 → entryFound=false 但无缺失字段', () => {
    const check = validatePluginOutput([], spec());
    expect(check.outputIsArray).toBe(true);
    expect(check.entryFound).toBe(false);
    expect(check.missingFields).toEqual([]);
    expect(contractCheckHint(check)).toContain('为空');
  });

  it('未知扩展点不强制 rank/id', () => {
    const check = validatePluginOutput([{ foo: 1 }], spec({ pointId: 'other.point' }));
    expect(check.entryFound).toBe(true);
  });

  it('hint 对缺字段给出可操作提示', () => {
    const check = validatePluginOutput([{ id: 1 }], spec());
    expect(contractCheckHint(check)).toContain('rank');
  });
});
