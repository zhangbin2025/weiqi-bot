import { describe, it, expect } from 'vitest';
import { PluginValidator, validatePluginOutput, contractCheckHint } from '../PluginValidator';
import { RANKING_SPEC, type PluginSpec } from '@domain/plugin/types';
import { SAMPLE_RANKING_INPUT } from '@domain/ranking/sampleInput';

const validator = new PluginValidator();
const spec = (overrides?: Partial<PluginSpec>): PluginSpec => ({
  ...RANKING_SPEC,
  ...overrides,
  limits: { ...RANKING_SPEC.limits, ...overrides?.limits },
});

const good = 'function rank(input){ return { columns:[{key:"score",label:"积分"}], rows:[] } }';

/** 合法输出：覆盖样例对阵里的 3 名选手，cells 数值 */
function goodOutput(): unknown {
  return {
    columns: [{ key: 'score', label: '积分' }],
    rows: [
      { id: 1, name: '甲', rank: 1, cells: { score: 4 } },
      { id: 2, name: '乙', rank: 2, cells: { score: 2 } },
      { id: 3, name: '丙', rank: 3, cells: { score: 2 } },
    ],
  };
}

/** 校验输出时用同一份代表性对阵 */
const check = (output: unknown) => validatePluginOutput(output, spec(), SAMPLE_RANKING_INPUT);

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

  it('不误伤普通标识符', () => {
    expect(validator.validate('function rank(p){ const x = 1; return p }', spec()).ok).toBe(true);
  });
});

describe('validatePluginOutput（统一排名表契约）', () => {
  it('结构正确的 { columns, rows } 对象通过；outputIsArray 恒为 false', () => {
    const c = check(goodOutput());
    expect(c.outputIsArray).toBe(false);
    expect(c.entryFound).toBe(true);
    expect(c.missingFields).toEqual([]);
    expect(contractCheckHint(c)).toContain('符合契约');
  });

  it('非对象 / 数组输入 → entryFound=false', () => {
    expect(check({ id: 1, rank: 1 }).entryFound).toBe(false);
    expect(check([]).entryFound).toBe(false);
    expect(contractCheckHint(check([]))).toContain('对象');
  });

  it('缺 columns / rows → 汇总缺失字段', () => {
    expect(check({ rows: [] }).missingFields).toContain('columns');
    expect(check({ columns: [] }).missingFields).toContain('rows');
  });

  it('列名不是汉字 / key 非法 / 保留列冲突 → 拒绝', () => {
    const bad = (columns: unknown): unknown => ({
      columns,
      rows: [
        { id: 1, name: '甲', rank: 1, cells: {} },
        { id: 2, name: '乙', rank: 2, cells: {} },
        { id: 3, name: '丙', rank: 3, cells: {} },
      ],
    });
    expect(check(bad([{ key: 'score', label: 'Score' }])).entryFound).toBe(false);
    expect(check(bad([{ key: '1bad', label: '积分' }])).entryFound).toBe(false);
    expect(check(bad([{ key: 'name', label: '姓名' }])).entryFound).toBe(false);
    expect(check(bad([{ key: 'rank', label: '名次' }])).entryFound).toBe(false);
  });

  it('cells 支持数值与数值数组，拒绝字符串/HTML/对象', () => {
    const out = (cellValue: unknown): unknown => ({
      columns: [{ key: 'score', label: '积分' }, { key: 'reverse', label: '逆减' }],
      rows: [
        { id: 1, name: '甲', rank: 1, cells: { score: 4, reverse: cellValue } },
        { id: 2, name: '乙', rank: 2, cells: { score: 2, reverse: [3, 12] } },
        { id: 3, name: '丙', rank: 3, cells: { score: 2, reverse: [1, 5] } },
      ],
    });
    expect(check(out(6)).entryFound).toBe(true); // 单个数值
    expect(check(out([3, 12])).entryFound).toBe(true); // 数值数组
    expect(check(out([])).entryFound).toBe(true); // 空数组也合法
    expect(check(out('3-12')).entryFound).toBe(false); // 字符串不允许
    expect(check(out('<b>3</b>')).entryFound).toBe(false);
    expect(check(out([1, '2'])).entryFound).toBe(false); // 数组里混字符串不行
    expect(check(out([1, NaN])).entryFound).toBe(false); // 非有限数值不行
    expect(check(out({ v: 1 })).entryFound).toBe(false);
  });

  it('cells 缺列 → 拒绝', () => {
    const out = {
      columns: [{ key: 'score', label: '积分' }],
      rows: [
        { id: 1, name: '甲', rank: 1, cells: {} },
        { id: 2, name: '乙', rank: 2, cells: { score: 2 } },
        { id: 3, name: '丙', rank: 3, cells: { score: 2 } },
      ],
    };
    expect(check(out).entryFound).toBe(false);
    expect(check(out).missingFields).toContain('rows[].cells.score(number|number[])');
  });

  it('id 伪造 / name 改写 / rank 非数值 → 拒绝', () => {
    const base = goodOutput() as { columns: unknown; rows: Array<Record<string, unknown>> };
    const fakeId = { ...base, rows: base.rows.map((r, i) => i === 0 ? { ...r, id: 99 } : r) };
    expect(check(fakeId).entryFound).toBe(false);
    const badName = { ...base, rows: base.rows.map((r, i) => i === 0 ? { ...r, name: '改名' } : r) };
    expect(check(badName).entryFound).toBe(false);
    const badRank = { ...base, rows: base.rows.map((r, i) => i === 0 ? { ...r, rank: '1' } : r) };
    expect(check(badRank).entryFound).toBe(false);
  });

  it('rows 未覆盖全部选手 → 拒绝', () => {
    const out = {
      columns: [{ key: 'score', label: '积分' }],
      rows: [{ id: 1, name: '甲', rank: 1, cells: { score: 4 } }],
    };
    expect(check(out).entryFound).toBe(false);
  });

  it('hint 对缺字段给出可操作提示（含数值数组说明）', () => {
    const c = check({ columns: [{ key: 'score', label: '积分' }], rows: [] });
    expect(contractCheckHint(c)).toContain('cells');
    expect(contractCheckHint(c)).toContain('数值数组');
  });

  it('省略 input 时按代表性对阵样例校验（合法输出仍通过）', () => {
    const c = validatePluginOutput(goodOutput(), spec());
    expect(c.entryFound).toBe(true);
  });
});
