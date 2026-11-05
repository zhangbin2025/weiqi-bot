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

const players = [
  { name: 'A', score: 4, wins: 2 },
  { name: 'B', score: 4, wins: 1 },
  { name: 'C', score: 2, wins: 1 },
];

const rankCode = `
function rank(players) {
  return players.slice()
    .sort((a,b)=> b.score-a.score || b.wins-a.wins)
    .map((p,i)=> ({ ...p, rank: i+1 }));
}`;

describe('QuickJsExecutor', () => {
  it('正确执行排序插件并返回带 rank 的结果', async () => {
    const result = await executor().execute({ code: rankCode, input: players, spec: makeSpec() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = result.output as Array<{ name: string; rank: number }>;
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
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
    const result = await executor().execute({ code: rankCode, input: players, spec });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('contract');
  });

  it('输入以 JSON 传入，插件拿到的是副本而非宿主引用', async () => {
    const code = `function rank(x){ x[0].score = 999; return x }`;
    const result = await executor().execute({ code, input: players, spec: makeSpec() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.output as typeof players)[0].score).toBe(999);
    expect(players[0].score).toBe(4);
  });

  it('同一执行器连续多次执行互不污染（独立 Runtime/Context）', async () => {
    const ex = executor();
    const first = await ex.execute({ code: rankCode, input: players, spec: makeSpec() });
    const second = await ex.execute({ code: rankCode, input: players.slice().reverse(), spec: makeSpec() });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect((second.output as Array<{ name: string }>).map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
});
