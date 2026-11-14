/**
 * 插件开发工具集契约测试
 *
 * 核心验收：根治「第一版快、验收后迭代做不下去」——
 * 新建 / 第二版 / 第三版全部走同一个 plugin_write 执行器，没有重载特殊循环、
 * 没有 verifier、没有 diff 闸门。每次写入都做确定性试算并回填排名表。
 *
 * 同时锁住：试算失败不落库、调试不修改工件、历史/回滚/启停/应用/删除，
 * 以及 plugin_apply 必须兼容赛事页选择键。
 */

import { describe, it, expect, vi } from 'vitest';
import { createPluginToolKit, PLUGIN_TOOL_NAMES, type PluginToolDeps } from '../PluginTools';
import { PluginArtifactService } from '../PluginArtifactService';
import { PluginContextProvider } from '../PluginContextProvider';
import { InMemoryPluginArtifactStore } from '@infrastructure/plugin/InMemoryPluginArtifactStore';
import { PluginValidator } from '@domain/plugin/PluginValidator';
import { RANKING_SPEC, RANKING_POINT_ID, type IPluginRuntime, type PluginRunResult } from '@domain/plugin/types';
import type { RankingOutput } from '@domain/ranking/types';

/** 合法输出：覆盖样例里的 3 名真实选手（甲/乙/丙），不新增、不缺失 */
function validOutput(extraLabel = '积分'): RankingOutput {
  return {
    columns: [{ key: 'score', label: extraLabel }],
    rows: [
      { id: 1, name: '甲', rank: 1, cells: { score: 2 } },
      { id: 2, name: '乙', rank: 2, cells: { score: 2 } },
      { id: 3, name: '丙', rank: 3, cells: { score: 2 } },
    ],
  };
}

const okRun = (label = '积分'): PluginRunResult =>
  ({ ok: true, output: validOutput(label), logs: [], elapsedMs: 1 });

const CODE_V1 = 'function rank(input){ return { columns:[], rows:[] } } /* v1 */';
const CODE_V2 = 'function rank(input){ return { columns:[], rows:[] } } /* v2 */';
const CODE_V3 = 'function rank(input){ return { columns:[], rows:[] } } /* v3 */';

interface Harness {
  deps: PluginToolDeps;
  artifacts: PluginArtifactService;
  runtime: { run: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
  applySelection: ReturnType<typeof vi.fn>;
  store: InMemoryPluginArtifactStore;
}

function harness(opts: {
  runResult?: PluginRunResult;
  runImpl?: (code: string, input: unknown) => Promise<PluginRunResult>;
} = {}): Harness {
  const store = new InMemoryPluginArtifactStore();
  const artifacts = new PluginArtifactService(store);
  const snapshot = new PluginContextProvider(store);
  const run = opts.runImpl
    ? vi.fn(opts.runImpl)
    : vi.fn(async () => opts.runResult ?? okRun());
  const runtime = { run, dispose: vi.fn() } as unknown as IPluginRuntime & {
    run: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>;
  };
  const applySelection = vi.fn(async (_id: string | undefined) => undefined);
  return {
    deps: {
      artifacts, runtime, snapshot,
      validator: new PluginValidator(),
      applySelection,
    },
    artifacts, runtime, applySelection, store,
  };
}

/** 直接调某个执行器，模拟一次 tool_call */
async function call(h: Harness, name: string, args: Record<string, unknown>) {
  const kit = createPluginToolKit(h.deps);
  const exec = kit.executors[name];
  if (!exec) throw new Error(`没有执行器 ${name}`);
  return exec(JSON.stringify(args));
}

describe('createPluginToolKit', () => {
  it('暴露 9 个工具声明 + 动态 system + maxTurns', async () => {
    const h = harness();
    const kit = createPluginToolKit(h.deps);
    expect(kit.tools.map((t) => t.name)).toEqual([
      'plugin_list', 'plugin_show', 'plugin_history', 'plugin_write', 'plugin_debug',
      'plugin_toggle', 'plugin_delete', 'plugin_apply', 'plugin_rollback',
    ]);
    expect(kit.maxTurns).toBeGreaterThan(1);
    const sys = await kit.systemPrompt();
    expect(sys).toContain('plugin_write');
    expect(sys).toContain('当前没有任何插件');
  });

  it('system 实时读清单：新建后立刻能看到插件（不依赖会话历史）', async () => {
    const h = harness();
    await h.artifacts.create({
      name: '规则1', intent: '同分比胜局', code: CODE_V1,
      pointId: RANKING_POINT_ID, origin: 'llm', spec: RANKING_SPEC,
    });
    const kit = createPluginToolKit(h.deps);
    const sys = await kit.systemPrompt();
    expect(sys).toContain('规则1');
    expect(sys).toContain('同分比胜局');
  });
});

describe('plugin_write：创建与迭代修订同构（核心）', () => {
  it('新建 → 第二版 → 第三版：同一个工具、同一条试算路径，版本链递增', async () => {
    const h = harness({
      // 每版返回不同列名，证明观察确实来自「这一版」的试算
      runImpl: async (code: string) => okRun(
        code.includes('v3') ? '第三版' : code.includes('v2') ? '第二版' : '第一版',
      ),
    });

    const v1 = await call(h, PLUGIN_TOOL_NAMES.write, { intent: '按积分排名', code: CODE_V1 });
    expect(v1.ok).toBe(true);
    expect(v1.observation).toContain('已新建插件候选');
    expect(v1.observation).toContain('第一版');
    expect(v1.code).toBe(CODE_V1);

    const list = await h.artifacts.list();
    const id = list[0]!.id;
    expect(list[0]!.version).toBe(1);
    expect(list[0]!.enabled).toBe(false); // 人工闸门：候选默认停用

    const v2 = await call(h, PLUGIN_TOOL_NAMES.write, {
      artifactId: id, code: CODE_V2, feedback: '加一列胜局',
    });
    expect(v2.ok).toBe(true);
    expect(v2.observation).toContain('v1 → v2');
    expect(v2.observation).toContain('第二版');

    const v3 = await call(h, PLUGIN_TOOL_NAMES.write, {
      artifactId: id, code: CODE_V3, feedback: '再改一次顺序',
    });
    expect(v3.ok).toBe(true);
    expect(v3.observation).toContain('v2 → v3');
    expect(v3.observation).toContain('第三版');

    const final = await h.artifacts.get(id);
    expect(final!.version).toBe(3);
    expect(final!.code).toBe(CODE_V3);
    expect(final!.history).toHaveLength(3);
    expect(final!.history[0]!.code).toBe(CODE_V1);
    expect(final!.history[1]!.code).toBe(CODE_V2);
    expect(final!.history[2]!.code).toBe(CODE_V3);
    expect(final!.intent).toBe('按积分排名'); // 修订不丢原始需求
  });

  it('试算失败不落库，失败原因作为观察回喂（模型下一轮自行修正）', async () => {
    const h = harness({
      runResult: {
        ok: false, phase: 'runtime', error: { name: 'TypeError', message: 'p is undefined' },
        logs: [], elapsedMs: 1,
      },
    });
    const r = await call(h, PLUGIN_TOOL_NAMES.write, { intent: '坏代码', code: CODE_V1 });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('试算失败');
    expect(r.observation).toContain('p is undefined');
    expect(r.code).toBe(CODE_V1); // 源码随观察回喂，便于下一轮改
    expect(await h.artifacts.list()).toHaveLength(0); // 没落库
  });

  it('代码预检不通过（含 require）不进沙箱、不落库', async () => {
    const h = harness();
    const r = await call(h, PLUGIN_TOOL_NAMES.write, {
      intent: '危险代码', code: 'const x = require("fs"); function rank(i){ return i }',
    });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('代码预检未通过');
    expect(h.runtime.run).not.toHaveBeenCalled();
    expect(await h.artifacts.list()).toHaveLength(0);
  });

  it('新建缺 intent / 修订的 id 不存在 → 明确失败观察，不乱建', async () => {
    const h = harness();
    expect((await call(h, PLUGIN_TOOL_NAMES.write, { code: CODE_V1 })).observation)
      .toContain('必须给 intent');
    expect((await call(h, PLUGIN_TOOL_NAMES.write, { artifactId: 'plugin:nope', code: CODE_V1 })).observation)
      .toContain('找不到插件');
    expect(await h.artifacts.list()).toHaveLength(0);
  });

  it('模型带 ```js 代码围栏时自动剥掉', async () => {
    const h = harness();
    const r = await call(h, PLUGIN_TOOL_NAMES.write, {
      intent: '带围栏', code: '```js\n' + CODE_V1 + '\n```',
    });
    expect(r.ok).toBe(true);
    expect((await h.artifacts.list())[0]!.code).toBe(CODE_V1);
  });
});

describe('plugin_debug：试算不修改工件', () => {
  it('临时源码 + 自定义 matches：用自定义输入试算，不落库', async () => {
    const h = harness();
    const customMatches = [
      { bout: 1, p1Id: 9, p1Name: 'X', p1Score: 2, p2Id: 8, p2Name: 'Y', p2Score: 0 },
    ];
    const r = await call(h, PLUGIN_TOOL_NAMES.debug, { code: CODE_V1, matches: customMatches });
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('自定义对阵表');
    expect(r.observation).toContain('不修改任何工件');
    const passed = h.runtime.run.mock.calls[0]![1] as { matches: unknown[] };
    expect(passed.matches).toEqual(customMatches);
    expect(await h.artifacts.list()).toHaveLength(0);
  });

  it('已存插件按 id 试算；非法 matches 给明确诊断', async () => {
    const h = harness();
    const a = await h.artifacts.create({
      name: '规则', intent: 'x', code: CODE_V1,
      pointId: RANKING_POINT_ID, origin: 'llm', spec: RANKING_SPEC,
    });
    const ok = await call(h, PLUGIN_TOOL_NAMES.debug, { artifactId: a.id });
    expect(ok.ok).toBe(true);
    expect(ok.observation).toContain('内置代表性样例');
    const bad = await call(h, PLUGIN_TOOL_NAMES.debug, { code: CODE_V1, matches: [{ bout: 1 }] });
    expect(bad.ok).toBe(false);
    expect(bad.observation).toContain('缺少');
  });

  it('code 与 artifactId 都没给 → 明确要求至少给一个', async () => {
    const h = harness();
    expect((await call(h, PLUGIN_TOOL_NAMES.debug, {})).observation).toContain('code 或 artifactId');
  });
});

describe('查看 / 历史 / 启停 / 回滚 / 删除 / 应用', () => {
  async function seeded() {
    const h = harness();
    const a = await h.artifacts.create({
      name: '规则', intent: 'x', code: CODE_V1,
      pointId: RANKING_POINT_ID, origin: 'llm', spec: RANKING_SPEC,
    });
    await h.artifacts.revise(a.id, { code: CODE_V2, trigger: 'user-feedback', feedback: '改一版' });
    return { h, id: a.id };
  }

  it('plugin_list / show / history 读真实工件', async () => {
    const { h, id } = await seeded();
    expect((await call(h, PLUGIN_TOOL_NAMES.list, {})).observation).toContain('规则');
    const show = await call(h, PLUGIN_TOOL_NAMES.show, { artifactId: id });
    expect(show.observation).toContain('【完整源码】');
    expect(show.code).toBe(CODE_V2);
    const showV1 = await call(h, PLUGIN_TOOL_NAMES.show, { artifactId: id, version: 1 });
    expect(showV1.code).toBe(CODE_V1);
    const hist = await call(h, PLUGIN_TOOL_NAMES.history, { artifactId: id });
    expect(hist.observation).toContain('共 2 个版本');
    expect(hist.observation).toContain('改一版');
  });

  it('plugin_toggle 启停：省略 enabled 翻转，状态真实写入', async () => {
    const { h, id } = await seeded();
    expect((await call(h, PLUGIN_TOOL_NAMES.toggle, { artifactId: id })).observation).toContain('已启用');
    expect((await h.artifacts.get(id))!.enabled).toBe(true);
    expect((await call(h, PLUGIN_TOOL_NAMES.toggle, { artifactId: id })).observation).toContain('已停用');
    expect((await h.artifacts.get(id))!.enabled).toBe(false);
    expect((await call(h, PLUGIN_TOOL_NAMES.toggle, { artifactId: id, enabled: false })).observation)
      .toContain('原本就停用');
  });

  it('plugin_apply：停用插件拒绝应用；启用后写入选择；省略 id 切回内置', async () => {
    const { h, id } = await seeded();
    expect((await call(h, PLUGIN_TOOL_NAMES.apply, { artifactId: id })).observation).toContain('目前停用');
    expect(h.applySelection).not.toHaveBeenCalled();

    await h.artifacts.setEnabled(id, true);
    const applied = await call(h, PLUGIN_TOOL_NAMES.apply, { artifactId: id });
    expect(applied.ok).toBe(true);
    expect(h.applySelection).toHaveBeenCalledWith(id);

    const back = await call(h, PLUGIN_TOOL_NAMES.apply, {});
    expect(back.observation).toContain('已切回内置排名');
    expect(h.applySelection).toHaveBeenLastCalledWith(undefined);
  });

  it('plugin_rollback：历史源码也要过同一试算，产生新版本并保留全部快照', async () => {
    const { h, id } = await seeded();
    const r = await call(h, PLUGIN_TOOL_NAMES.rollback, { artifactId: id, version: 1 });
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('回滚到 v1');
    expect(r.observation).toContain('v3'); // 2 → 新版本 3
    const final = await h.artifacts.get(id);
    expect(final!.version).toBe(3);
    expect(final!.code).toBe(CODE_V1); // 内容回到 v1
    expect(final!.history).toHaveLength(3); // 旧快照全保留
    expect((await call(h, PLUGIN_TOOL_NAMES.rollback, { artifactId: id, version: 99 })).observation)
      .toContain('没有 v99');
  });

  it('plugin_delete 真删除，之后 list/show 明确找不到', async () => {
    const { h, id } = await seeded();
    expect((await call(h, PLUGIN_TOOL_NAMES.delete, { artifactId: id })).ok).toBe(true);
    expect(await h.artifacts.list()).toHaveLength(0);
    expect((await call(h, PLUGIN_TOOL_NAMES.show, { artifactId: id })).observation).toContain('找不到插件');
  });
});

describe('参数健壮性（失败一律变观察，不抛给 loop）', () => {
  it('非法 JSON / 缺必填参数 → 失败观察而非异常', async () => {
    const h = harness();
    const kit = createPluginToolKit(h.deps);
    expect((await kit.executors[PLUGIN_TOOL_NAMES.show]!('not json')).ok).toBe(false);
    expect((await kit.executors[PLUGIN_TOOL_NAMES.show]!('{}')).observation).toContain('缺少 artifactId');
    expect((await kit.executors[PLUGIN_TOOL_NAMES.toggle]!('[]')).ok).toBe(false);
  });
});
