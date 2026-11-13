/**
 * QuickJS 执行核心测试
 *
 * 用真实 wasm 二进制（从 node_modules 读取）运行，覆盖：
 * 零能力、正确执行、语法/运行时诊断、资源配额、hostApi 注入、输入隔离。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QuickJsExecutor } from '../QuickJsExecutor';
import { RANKING_SPEC, type PluginSpec } from '../../../domain/plugin/types';

const wasmPath = resolve(
  process.cwd(),
  'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm',
);

function loadWasm(): ArrayBuffer {
  const buf = readFileSync(wasmPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makeSpec(overrides?: Partial<PluginSpec>): PluginSpec {
  return { ...RANKING_SPEC, ...overrides, limits: { ...RANKING_SPEC.limits, ...overrides?.limits } };
}

function executor(): QuickJsExecutor {
  return new QuickJsExecutor({ wasmBinary: loadWasm() });
}

// 唯一原始数据源：对阵表。插件自己从 matches 算出积分并产出 { columns, rows }。
const input = {
  matches: [
    { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
    { bout: 1, p1Id: 3, p1Name: 'C', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
  ],
};

const rankCode = `
function rank(input) {
  const scores = {};
  for (const m of input.matches) {
    scores[m.p1Name] = (scores[m.p1Name] || 0) + m.p1Score;
    scores[m.p2Name] = (scores[m.p2Name] || 0) + m.p2Score;
  }
  const rows = [];
  let id = 1;
  for (const name of Object.keys(scores)) {
    rows.push({ id: id++, name: name, rank: 1, cells: { score: scores[name], multi: [3, 12] } });
  }
  rows.sort((a,b) => b.cells.score - a.cells.score);
  rows.forEach((r,i) => r.rank = i+1);
  return { columns: [{ key: 'score', label: '积分' }, { key: 'multi', label: '逆减' }], rows: rows };
}`;

describe('QuickJsExecutor', () => {
  it('正确执行排名插件并返回 { columns, rows }（含数值数组 cells）', async () => {
    const result = await executor().execute({ code: rankCode, input, spec: makeSpec() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.output as {
      columns: Array<{ key: string; label: string }>;
      rows: Array<{ name: string; rank: number; cells: Record<string, number | number[]> }>;
    };
    expect(out.columns.map((c) => c.label)).toEqual(['积分', '逆减']);
    expect(out.rows.map((r) => r.name)).toEqual(['A', 'C']);
    expect(out.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(out.rows[0]!.cells['multi']).toEqual([3, 12]);
  });

  it('浏览器全局全部不可见（零能力）', async () => {
    const code = `function rank(){ return [typeof fetch, typeof window, typeof document,
      typeof localStorage, typeof indexedDB, typeof postMessage, typeof require,
      typeof XMLHttpRequest, typeof navigator, typeof importScripts]; }`;
    const result = await executor().execute({ code, input: [], spec: makeSpec() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toEqual(Array(10).fill('undefined'));
  });

  it('访问不存在的全局被拦截，不会逃逸到宿主', async () => {
    const code = `function rank(){ try { fetch('https://evil.example'); return ['escaped']; }
      catch(e) { return ['blocked']; } }`;
    const result = await executor().execute({ code, input: [], spec: makeSpec() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toEqual(['blocked']);
  });

  it('语法错误返回 compile 诊断并带行号', async () => {
    const code = 'function rank(x){ return x.sort((a,b)=> ) }';
    const result = await executor().execute({ code, input: [], spec: makeSpec() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('compile');
    expect(result.error?.name).toBe('SyntaxError');
    expect(result.error?.lineNumber).toBe(1);
    expect(result.hint).toContain('语法错误');
  });

  it('运行时错误返回带调用栈的诊断', async () => {
    const code = 'function rank(x){ return x.map(p=>p.nope.toFixed(2)) }';
    const result = await executor().execute({ code, input: [{ score: 1 }], spec: makeSpec() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('runtime');
    expect(result.error?.name).toBe('TypeError');
    expect(result.error?.stack).toContain('rank');
  });

  it('死循环被协作式中断拦住并归类 timeout', async () => {
    const code = 'function rank(x){ let i=0; while(true){ i++ } }';
    const spec = makeSpec({ limits: { ...RANKING_SPEC.limits, timeoutMs: 250 } });
    const result = await executor().execute({ code, input: [], spec });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('timeout');
    expect(result.error?.message).toContain('interrupted');
  });

  it('内存炸弹被拦住并归类 oom', async () => {
    const code = 'function rank(){ const a=[]; while(true){ a.push(new Array(100000).fill(1)) } }';
    const spec = makeSpec({ limits: { ...RANKING_SPEC.limits, timeoutMs: 3000, memoryBytes: 8 * 1024 * 1024 } });
    const result = await executor().execute({ code, input: [], spec });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('oom');
  });

  it('输出超限时给出 contract 失败', async () => {
    const code = 'function rank(){ return new Array(100000).fill("x") }';
    const spec = makeSpec({ limits: { ...RANKING_SPEC.limits, maxOutputBytes: 1024 } });
    const result = await executor().execute({ code, input: [], spec });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('contract');
    expect(result.hint).toContain('只返回必要');
  });

  it('hostApi 只有被显式声明的函数才存在，且调用被记录', async () => {
    const code = `function rank(x){ log("start"); return [typeof log, typeof secret].map(String) }`;
    const withLog = await executor().execute({
      code, input: [], spec: makeSpec({ hostApi: ['log'] }),
    });
    expect(withLog.ok).toBe(true);
    if (!withLog.ok) return;
    expect(withLog.output).toEqual(['function', 'undefined']);
    expect(withLog.logs[0]).toContain('log:start');

    const noLog = await executor().execute({
      code: `function rank(){ return [typeof log] }`, input: [], spec: makeSpec(),
    });
    expect(noLog.ok).toBe(true);
    if (!noLog.ok) return;
    expect(noLog.output).toEqual(['undefined']);
  });

  it('入口名非法时拒绝执行（防注入到调用表达式）', async () => {
    const spec = makeSpec({ entry: 'rank();evil(' });
    const result = await executor().execute({ code: rankCode, input, spec });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('contract');
  });

  it('输入以 JSON 传入，插件拿到的是副本而非宿主引用', async () => {
    const code = `function rank(x){ x.matches[0].p1Score = 999; return x }`;
    const result = await executor().execute({ code, input, spec: makeSpec() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.output as typeof input).matches[0]!.p1Score).toBe(999);
    expect(input.matches[0]!.p1Score).toBe(2);
  });

  it('同一执行器连续多次执行互不污染（独立 Runtime/Context）', async () => {
    const ex = executor();
    const first = await ex.execute({ code: rankCode, input, spec: makeSpec() });
    const second = await ex.execute({ code: rankCode, input, spec: makeSpec() });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const rows = (second.output as { rows: Array<{ name: string }> }).rows;
    expect(rows.map((r) => r.name)).toEqual(['A', 'C']);
  });
});
