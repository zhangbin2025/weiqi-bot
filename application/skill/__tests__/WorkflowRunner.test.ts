/**
 * 阶段二 WorkflowRunner 纯逻辑单测（不依赖 QuickJS / 网络 / DOM）。
 *
 * 用内存假 OperatorRegistry 覆盖契约「runner 语义」+「URL 模板 / 占位符」两条规则：
 * - 链成功：上游 value 经 binding 注入下游 args；
 * - 仅显式 yield:true 节点的 value 进汇总；
 * - 失败短路：抛错节点前已完成、后续不执行，结构化失败信息齐全；
 * - 运行前防御：未注册算子 → 「未注册算子:<name>」，一个节点都不跑；
 * - 规则① 完整等于 `{{input.xxx}}` → 注入原始类型值（integer/array 不 String()）；
 * - 规则② 内嵌 `{{input.xxx}}` → 逐字 String() 替换（URL 文本）；
 * - inputs 契约：default / required / enum / type 校验；
 * - 过程块：开头「共 N 步」、每步「第 k/N 步」、失败 ok:false、纯展示抛错不影响主流程。
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginTraceStep, StepResult, OperatorSpec } from '@domain/plugin/types';
import type { OperatorRegistry } from '@application/plugin/OperatorRegistry';
import type { WorkflowSpec, WorkflowStep, WorkflowInput } from '../SkillTypes';
import { runWorkflow } from '../WorkflowRunner';

/** 最小内存假算子表：按名注册 run，get/run 与真实 OperatorRegistry 同形。 */
function fakeRegistry(
  ops: Record<string, (args: Record<string, unknown>) => StepResult | Promise<StepResult>>,
): OperatorRegistry & { calls: string[] } {
  const specs = new Map<string, OperatorSpec>();
  for (const [name, fn] of Object.entries(ops)) {
    specs.set(name, { name, description: name, inputSchema: { type: 'object' }, outputSchema: {}, kind: 'pure', idempotent: true, run: async (args) => fn(args) });
  }
  const calls: string[] = [];
  return {
    specs,
    calls,
    get: (name: string) => specs.get(name),
    run: async (name: string, args: Record<string, unknown>): Promise<StepResult> => {
      calls.push(name);
      const op = specs.get(name);
      if (!op) throw new Error(`未注册的算子：${name}`);
      return op.run(args);
    },
  };
}

const step = (over: Partial<WorkflowStep> & Pick<WorkflowStep, 'id' | 'call'>): WorkflowStep => ({
  ...(over.args !== undefined ? { args: over.args } : {}),
  ...(over.bindings !== undefined ? { bindings: over.bindings } : {}),
  ...(over.yield !== undefined ? { yield: over.yield } : {}),
  id: over.id,
  call: over.call,
});

const collectTrace = (): { steps: PluginTraceStep[]; onTrace: (s: PluginTraceStep) => void } => {
  const steps: PluginTraceStep[] = [];
  return { steps, onTrace: (s) => { steps.push(s); } };
};

describe('runWorkflow — 链成功 / 引用传递', () => {
  it('上游 value 经 binding 注入下游 args；仅 yield 节点 value 进汇总', async () => {
    const seen: Record<string, unknown>[] = [];
    const reg = fakeRegistry({
      first: () => ({ value: { list: [{ n: 7 }, { n: 8 }], meta: 'ok' } }),
      second: (args) => {
        seen.push(args);
        return { value: 'done', effects: [{ displayMarkdown: '第一段' }] };
      },
      third: () => ({ value: 'not-yielded' }),
    });
    const spec: WorkflowSpec = {
      steps: [
        step({ id: 'a', call: 'first', yield: true }),
        step({
          id: 'b', call: 'second', yield: true,
          args: { literal: 1 },
          bindings: [{ from: 'a', path: 'list[0].n', as: 'picked' }],
        }),
        step({ id: 'c', call: 'third' }), // 缺省 yield = false
      ],
    };
    const result = await runWorkflow(spec, {}, reg);
    expect(result.ok).toBe(true);
    expect(result.completedStepIds).toEqual(['a', 'b', 'c']);
    expect(result.values).toEqual({
      a: { list: [{ n: 7 }, { n: 8 }], meta: 'ok' },
      b: 'done',
    });
    expect(result.values['c']).toBeUndefined();
    expect(seen).toEqual([{ literal: 1, picked: 7 }]);
    expect(result.effects).toEqual([{ displayMarkdown: '第一段' }]);
  });

  it('binding path="$" 取整个上游 value；bindings 覆写字面量 args 同名键', async () => {
    let got: Record<string, unknown> = {};
    const reg = fakeRegistry({
      src: () => ({ value: [1, 2, 3] }),
      dst: (args) => { got = args; return { value: null }; },
    });
    const spec: WorkflowSpec = {
      steps: [
        step({ id: 's', call: 'src' }),
        step({
          id: 'd', call: 'dst', args: { value: 'literal-will-be-overwritten' },
          bindings: [{ from: 's', path: '$', as: 'value' }],
        }),
      ],
    };
    const result = await runWorkflow(spec, {}, reg);
    expect(result.ok).toBe(true);
    expect(got).toEqual({ value: [1, 2, 3] });
  });

  it('effects 按节点累积（不覆盖、不取最后一个）', async () => {
    const reg = fakeRegistry({
      a: () => ({ value: 1, effects: [{ displayMarkdown: 'A' }, { actionLink: 'https://a' }] }),
      b: () => ({ value: 2, effects: [{ displayMarkdown: 'B' }, { actionLink: 'https://b' }] }),
    });
    const spec: WorkflowSpec = { steps: [step({ id: 'a', call: 'a' }), step({ id: 'b', call: 'b' })] };
    const result = await runWorkflow(spec, {}, reg);
    expect(result.effects).toEqual([
      { displayMarkdown: 'A' }, { actionLink: 'https://a' },
      { displayMarkdown: 'B' }, { actionLink: 'https://b' },
    ]);
  });
});

describe('runWorkflow — 失败短路 / 结构化错误', () => {
  it('第二个节点抛错：第一个已完成、第三个不执行，失败信息含 stepId/error/completedStepIds', async () => {
    const reg = fakeRegistry({
      one: () => ({ value: 1 }),
      two: () => { throw new Error('算子内部炸了'); },
      three: () => ({ value: 3 }),
    });
    const spec: WorkflowSpec = {
      steps: [
        step({ id: 'one', call: 'one', yield: true }),
        step({ id: 'two', call: 'two' }),
        step({ id: 'three', call: 'three' }),
      ],
    };
    const { steps: trace, onTrace } = collectTrace();
    const result = await runWorkflow(spec, {}, reg, onTrace);
    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({
      stepId: 'two',
      error: '算子内部炸了',
      completedStepIds: ['one'],
    });
    expect(result.completedStepIds).toEqual(['one']);
    expect(reg.calls).toEqual(['one', 'two']); // 短路：three 未执行
    expect(result.values).toEqual({ one: 1 }); // 已完成 yield 节点仍保留
    // 过程块：开头「共 3 步」 + 第一步完成 + 失败块 = 3 条；最后一条 ok:false
    expect(trace.length).toBe(3);
    expect(trace[0]!.detail).toContain('共 3 步');
    expect(trace[0]!.ok).toBe(true);
    expect(trace[1]!.detail).toContain('第 1/3 步 one 完成');
    expect(trace[2]!.ok).toBe(false);
    expect(trace[2]!.detail).toContain('第 2/3 步 two 失败');
    expect(trace.every((s) => s.source === 'web' && s.attempt === 1 && s.phase === 'observe')).toBe(true);
  });

  it('未注册算子：运行前防御，结构化失败「未注册算子:<name>」，不执行任何节点', async () => {
    const reg = fakeRegistry({ known: () => ({ value: 1 }) });
    const spec: WorkflowSpec = {
      steps: [
        step({ id: 'a', call: 'known' }),
        step({ id: 'b', call: 'ghost_op' }),
      ],
    };
    const result = await runWorkflow(spec, {}, reg);
    expect(result.ok).toBe(false);
    expect(result.failure?.stepId).toBe('b');
    expect(result.failure?.error).toBe('未注册算子:ghost_op');
    expect(result.failure?.completedStepIds).toEqual([]);
    expect(reg.calls).toEqual([]); // 一个节点都没跑
  });

  it('binding 取不到值 → 结构化失败，不静默继续', async () => {
    const reg = fakeRegistry({
      src: () => ({ value: { a: 1 } }),
      dst: () => ({ value: 'should-not-run' }),
    });
    const spec: WorkflowSpec = {
      steps: [
        step({ id: 's', call: 'src' }),
        step({
          id: 'd', call: 'dst',
          bindings: [{ from: 's', path: 'missing.deep', as: 'x' }],
        }),
      ],
    };
    const result = await runWorkflow(spec, {}, reg);
    expect(result.ok).toBe(false);
    expect(result.failure?.stepId).toBe('d');
    expect(result.failure?.error).toContain('取不到值');
    expect(result.failure?.completedStepIds).toEqual(['s']);
    expect(reg.calls).toEqual(['src']); // dst 未执行
  });

  it('onTrace 抛错（纯展示失败）不影响主流程', async () => {
    const reg = fakeRegistry({ ok: () => ({ value: 42 }) });
    const spec: WorkflowSpec = { steps: [step({ id: 'a', call: 'ok', yield: true })] };
    const onTrace = vi.fn(() => { throw new Error('展示层炸了'); });
    const result = await runWorkflow(spec, {}, reg, onTrace);
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({ a: 42 });
    expect(onTrace).toHaveBeenCalled();
  });
});

describe('runWorkflow — 占位符规则①（完整等于 → 原始类型值）', () => {
  const decls: WorkflowInput[] = [
    { name: 'year', type: 'integer', required: true },
    { name: 'month', type: 'integer', required: true },
    { name: 'fields', type: 'array', default: [{ key: 'title' }] },
    { name: 'format', type: 'string', enum: ['list', 'table'], default: 'list' },
    { name: 'flag', type: 'boolean', default: true },
    { name: 'obj', type: 'object', default: { k: 'v' } },
  ];

  it('integer 占位注入 number（不是字符串）', async () => {
    let got: Record<string, unknown> = {};
    const reg = fakeRegistry({ calendar: (args) => { got = args; return { value: 'ok' }; } });
    const spec: WorkflowSpec = {
      steps: [step({
        id: 'c', call: 'calendar', args: { year: '{{input.year}}', month: '{{input.month}}' },
      })],
    };
    const result = await runWorkflow(spec, { year: 2026, month: 11 }, reg, undefined, decls);
    expect(result.ok).toBe(true);
    expect(got).toEqual({ year: 2026, month: 11 });
    expect(typeof (got as Record<string, unknown>)['year']).toBe('number');
  });

  it('array / boolean / object / enum 按原类型注入；default 原值同样按规则①', async () => {
    let got: Record<string, unknown> = {};
    const reg = fakeRegistry({ display: (args) => { got = args; return { value: 'ok' }; } });
    const spec: WorkflowSpec = {
      steps: [step({
        id: 'd', call: 'display',
        args: {
          format: '{{input.format}}', fields: '{{input.fields}}',
          flag: '{{input.flag}}', obj: '{{input.obj}}', note: '固定文案',
        },
      })],
    };
    // decls 里 year/month 是 required 且无 default，必须补齐才能过 inputs 校验；
    // 二者没写进 args 占位符，不注入节点、不影响下面的 got 断言。
    const result = await runWorkflow(spec, { year: 2026, month: 11 }, reg, undefined, decls);
    expect(result.ok).toBe(true);
    expect(got).toEqual({
      format: 'list', // enum default 字符串
      fields: [{ key: 'title' }], // array default，不是字符串
      flag: true, // boolean，不是字符串
      obj: { k: 'v' }, // object，不是字符串
      note: '固定文案',
    });
  });

  it('inputs 不 blanket 注入：配方没写占位符的节点收不到 input 键', async () => {
    let got: Record<string, unknown> = {};
    const reg = fakeRegistry({ fetch: (args) => { got = args; return { value: {} }; } });
    const spec: WorkflowSpec = {
      steps: [step({ id: 'f', call: 'fetch', args: { url: 'https://x', storeOnly: true } })],
    };
    const result = await runWorkflow(spec, { year: 2026, month: 11 }, reg, undefined, decls);
    expect(result.ok).toBe(true);
    expect(got).toEqual({ url: 'https://x', storeOnly: true }); // 无 year/month 等冗余键
  });
});

describe('runWorkflow — 占位符规则②（内嵌 → 逐字 String 替换）', () => {
  const decls: WorkflowInput[] = [
    { name: 'page', type: 'integer', default: 1 },
    { name: 'pagesize', type: 'integer', default: 20 },
    { name: 'tag', type: 'string', default: '' },
  ];

  it('URL 内嵌三个占位符逐字替换、保留 URL 其余文本', async () => {
    let got: Record<string, unknown> = {};
    const reg = fakeRegistry({ fetch: (args) => { got = args; return { value: {} }; } });
    const spec: WorkflowSpec = {
      steps: [step({
        id: 'f', call: 'fetch',
        args: {
          url: 'https://news/x?page={{input.page}}&tag={{input.tag}}&track=website&pagesize={{input.pagesize}}',
          storeOnly: true,
        },
      })],
    };
    const result = await runWorkflow(spec, { page: 3, pagesize: 50, tag: 'A股' }, reg, undefined, decls);
    expect(result.ok).toBe(true);
    expect((got as Record<string, unknown>)['url'])
      .toBe('https://news/x?page=3&tag=A股&track=website&pagesize=50');
    expect((got as Record<string, unknown>)['storeOnly']).toBe(true);
  });

  it('不递归展开替换结果：input 值本身含占位符文本也不再二次处理', async () => {
    let got: Record<string, unknown> = {};
    const reg = fakeRegistry({ fetch: (args) => { got = args; return { value: {} }; } });
    const spec: WorkflowSpec = {
      steps: [step({ id: 'f', call: 'fetch', args: { url: 'https://x?tag={{input.tag}}' } })],
    };
    const result = await runWorkflow(spec, { tag: '{{input.page}}' }, reg, undefined, decls);
    expect(result.ok).toBe(true);
    expect((got as Record<string, unknown>)['url']).toBe('https://x?tag={{input.page}}');
  });

  it('占位符在数组 / 嵌套对象叶子上同样生效', async () => {
    let got: Record<string, unknown> = {};
    const reg = fakeRegistry({ op: (args) => { got = args; return { value: null }; } });
    const spec: WorkflowSpec = {
      steps: [step({
        id: 'o', call: 'op',
        args: { list: ['{{input.tag}}', '固定', { deep: '{{input.page}}' }] },
      })],
    };
    const result = await runWorkflow(spec, { tag: 'T', page: 9 }, reg, undefined, decls);
    expect(result.ok).toBe(true);
    // 完整等于一个占位符的字符串按规则①注入原始类型（page 是 integer=9），
    // 与下面 got2 的 toEqual([9]) 同口径；原来的 '9' 是笔误。
    expect((got as Record<string, unknown>)['list']).toEqual(['T', '固定', { deep: 9 }]);
    // 规则① 在数组叶子上注入原始 integer：单独一个完整等于占位符的元素
    let got2: unknown[] = [];
    const reg2 = fakeRegistry({ op2: (args) => { got2 = args['list'] as unknown[]; return { value: null }; } });
    const spec2: WorkflowSpec = {
      steps: [step({ id: 'o2', call: 'op2', args: { list: ['{{input.page}}'] } })],
    };
    await runWorkflow(spec2, { page: 9 }, reg2, undefined, decls);
    expect(got2).toEqual([9]);
  });
});

describe('runWorkflow — inputs 契约校验（结构化失败，发生在节点前）', () => {
  it('required:true 未提供且无 default → 失败，stepId 用 <inputs> 哨兵', async () => {
    const reg = fakeRegistry({ op: () => ({ value: 1 }) });
    const decls: WorkflowInput[] = [{ name: 'city', type: 'string', required: true }];
    const spec: WorkflowSpec = { steps: [step({ id: 'a', call: 'op' })] };
    const result = await runWorkflow(spec, {}, reg, undefined, decls);
    expect(result.ok).toBe(false);
    expect(result.failure?.stepId).toBe('<inputs>');
    expect(result.failure?.error).toContain('city');
    expect(reg.calls).toEqual([]);
  });

  it('type 不符（integer 给了字符串）→ 失败', async () => {
    const reg = fakeRegistry({ op: () => ({ value: 1 }) });
    const decls: WorkflowInput[] = [{ name: 'n', type: 'integer', required: true }];
    const spec: WorkflowSpec = { steps: [step({ id: 'a', call: 'op' })] };
    const result = await runWorkflow(spec, { n: '3' }, reg, undefined, decls);
    expect(result.ok).toBe(false);
    expect(result.failure?.error).toContain('形状不符');
  });

  it('enum 不匹配 → 失败', async () => {
    const reg = fakeRegistry({ op: () => ({ value: 1 }) });
    const decls: WorkflowInput[] = [
      { name: 'format', type: 'string', enum: ['list', 'table'], default: 'list' },
    ];
    const spec: WorkflowSpec = { steps: [step({ id: 'a', call: 'op' })] };
    const result = await runWorkflow(spec, { format: 'chart' }, reg, undefined, decls);
    expect(result.ok).toBe(false);
    expect(result.failure?.error).toContain('enum');
  });

  it('required 缺省且无 default（required:false）→ 不注入、不失败', async () => {
    let got: Record<string, unknown> = {};
    const reg = fakeRegistry({ op: (args) => { got = args; return { value: 1 }; } });
    const decls: WorkflowInput[] = [{ name: 'opt', type: 'string', required: false }];
    const spec: WorkflowSpec = { steps: [step({ id: 'a', call: 'op', args: { k: 1 } })] };
    const result = await runWorkflow(spec, {}, reg, undefined, decls);
    expect(result.ok).toBe(true);
    expect(got).toEqual({ k: 1 });
  });

  it('未解析的占位符名 → 结构化失败，不静默留原文', async () => {
    const reg = fakeRegistry({ op: () => ({ value: 1 }) });
    const spec: WorkflowSpec = {
      steps: [step({ id: 'a', call: 'op', args: { x: '{{input.ghost}}' } })],
    };
    const result = await runWorkflow(spec, {}, reg, undefined, []);
    expect(result.ok).toBe(false);
    expect(result.failure?.stepId).toBe('a');
    expect(result.failure?.error).toContain('ghost');
    expect(reg.calls).toEqual([]);
  });
});

describe('runWorkflow — 过程块条数与文案', () => {
  it('成功 3 步：1 条「共 N 步」 + 3 条「第 k/N 步 … 完成」', async () => {
    const reg = fakeRegistry({
      a: () => ({ value: 1 }), b: () => ({ value: 2 }), c: () => ({ value: 3 }),
    });
    const spec: WorkflowSpec = {
      steps: [
        step({ id: 'a', call: 'a' }), step({ id: 'b', call: 'b' }), step({ id: 'c', call: 'c' }),
      ],
    };
    const { steps: trace, onTrace } = collectTrace();
    await runWorkflow(spec, {}, reg, onTrace);
    expect(trace.length).toBe(4);
    expect(trace[0]!.detail).toBe('workflow 共 3 步');
    expect(trace[1]!.detail).toContain('第 1/3 步 a 完成');
    expect(trace[2]!.detail).toContain('第 2/3 步 b 完成');
    expect(trace[3]!.detail).toContain('第 3/3 步 c 完成');
    expect(trace.every((s) => s.source === 'web' && s.attempt === 1 && s.phase === 'observe')).toBe(true);
  });
});


describe('runWorkflow — 通用控制结构补齐', () => {
  it('forEach onError=continue：单项失败被记录，后续项继续，成功项统一包装', async () => {
    const reg = fakeRegistry({
      source: () => ({ value: [1, 2, 3] }),
      double: (args) => {
        if (args['value'] === 2) throw new Error('单项失败');
        return { value: Number(args['value']) * 2 };
      },
    });
    const spec: WorkflowSpec = {
      steps: [
        step({ id: 'source', call: 'source' }),
        {
          id: 'each',
          yield: true,
          forEach: {
            from: 'source', path: '$', onError: 'continue',
            steps: [step({ id: 'double', call: 'double', args: { value: '{{item}}' } })],
          },
        },
      ],
    };
    const result = await runWorkflow(spec, {}, reg);
    expect(result.ok).toBe(true);
    expect(result.values['each']).toEqual([
      { ok: true, value: 2 },
      { ok: false, error: { stepId: 'each[1]/double', message: '单项失败' } },
      { ok: true, value: 6 },
    ]);
    expect(reg.calls).toEqual(['source', 'double', 'double', 'double']);
  });

  it('ifElse 根据上游 boolean 选择一个分支，并把分支结果作为节点 value', async () => {
    const reg = fakeRegistry({
      condition: () => ({ value: { ready: true } }),
      yes: () => ({ value: 'then-result' }),
      no: () => ({ value: 'else-result' }),
    });
    const spec: WorkflowSpec = {
      steps: [
        step({ id: 'source', call: 'condition' }),
        {
          id: 'choice',
          yield: true,
          ifElse: {
            condition: { from: 'source', path: 'ready' },
            then: [step({ id: 'thenStep', call: 'yes' })],
            else: [step({ id: 'elseStep', call: 'no' })],
          },
        },
      ],
    };
    const result = await runWorkflow(spec, {}, reg);
    expect(result.ok).toBe(true);
    expect(result.values['choice']).toEqual({ condition: true, value: 'then-result' });
    expect(reg.calls).toEqual(['condition', 'yes']);
  });

  it('urlencode.input 占位符对动态 URL 参数执行组件编码', async () => {
    let received = '';
    const reg = fakeRegistry({
      fetch: (args) => { received = String(args['url']); return { value: true }; },
    });
    const inputs: WorkflowInput[] = [{ name: 'nickname', type: 'string', required: true }];
    const spec: WorkflowSpec = {
      steps: [step({
        id: 'fetch', call: 'fetch',
        args: { url: 'https://example.test/user?name={{urlencode.input.nickname}}' },
      })],
    };
    const result = await runWorkflow(spec, { nickname: '张 三&?' }, reg, undefined, inputs);
    expect(result.ok).toBe(true);
    expect(received).toBe('https://example.test/user?name=%E5%BC%A0%20%E4%B8%89%26%3F');
  });
});


  it('repeat 用本轮节点结果更新 state，并在 until=true 时停止', async () => {
    const reg = fakeRegistry({
      advance: (args) => {
        const cursor = Number((args['state'] as Record<string, unknown>)['cursor']);
        return { value: { cursor: cursor + 1, done: cursor >= 1 } };
      },
    });
    const spec: WorkflowSpec = {
      steps: [{
        id: 'pages',
        yield: true,
        repeat: {
          maxIterations: 5,
          initialState: { cursor: 0 },
          stateFrom: { from: 'advance', path: '$' },
          until: { from: 'advance', path: 'done' },
          steps: [step({
            id: 'advance',
            call: 'advance',
            args: { state: '{{state}}' },
          })],
        },
      }],
    };
    const result = await runWorkflow(spec, {}, reg);
    expect(result.ok).toBe(true);
    expect(result.values['pages']).toEqual({
      items: [
        { cursor: 1, done: false },
        { cursor: 2, done: true },
      ],
      state: { cursor: 2, done: true },
      stopped: true,
    });
    expect(reg.calls).toEqual(['advance', 'advance']);
  });
