/**
 * 天气技能 v8「取数 + 加入自选链接」的回归测试。
 *
 * 只测安装链路（WeatherSkillInstall.test.ts）不够：技能能装进本地库，
 * 不代表模型那轮会挂上 run_workflow、也不代表 DAG 会走到 web_fetch。
 * 这里用真实 WorkflowRunner + 真实宿主算子（json.* / storage.*）跑兄弟仓的
 * 真实 skill.json，web_fetch 换成计数桩，锁住两件事：
 *  - operation=weatherBatch + cities 时，URL 模板正确解析并真的发起请求；
 *  - operation=storageGet 时绝不发天气请求（分派表不能串路）。
 *
 * 关键：runWorkflow 第 5 参必须传 recipe.inputs（WorkflowTool.ts:577 的口径），
 * 否则 {{input.operation}} 会报「没有对应的已解析 input」、一个节点都不跑。
 * 两仓同级部署时硬断言；单独 clone bot 仓（CI）用 skipIf 不造环境红灯。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OperatorSpec, StepResult, PluginArtifactService, IPluginRuntime } from '@domain/plugin/types';
import type { OperatorRegistry } from '@application/plugin/OperatorRegistry';
import type { WorkflowSpec, WorkflowInput } from '@application/skill/SkillTypes';
import { runWorkflow } from '@application/skill/WorkflowRunner';
import { createHostWorkflowOperators } from '@application/plugin/HostWorkflowOperators';
import { createOperatorRegistry } from '@application/plugin/OperatorRegistry';
import { createBasicPrimitives } from '@application/skill/primitives/BasicPrimitives';
import { createWorkflowStorageOperators } from '@application/plugin/WorkflowStorageOperators';
import { KvService } from '@application/skill/kv/KvService';
import { KvDomainRegistry } from '@application/skill/kv/KvDomains';
import { MemoryKvDriver } from '@application/skill/kv/KvDrivers';
import { CONTEXT_LIMITS } from '@application/chat/ConversationPrompt';
import type { KvDomainDescriptor } from '@application/skill/kv/KvTypes';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const WEATHER_SKILL_JSON = resolve(REPO_ROOT, '../weiqi-assets/skills/weather.wttr/skill.json');
const assetsAvailable = existsSync(WEATHER_SKILL_JSON);

interface WeatherRecipe {
  workflow: WorkflowSpec;
  inputs: WorkflowInput[];
  version: number;
}

function loadRecipe(): WeatherRecipe {
  return JSON.parse(readFileSync(WEATHER_SKILL_JSON, 'utf8')) as WeatherRecipe;
}

function makeKv(): KvService {
  return new KvService(new KvDomainRegistry([
    {
      name: 'prefs', summary: '偏好', driver: new MemoryKvDriver({ id: 'mem-prefs' }),
      visibility: 'readable', writableBy: 'model', physicalPrefix: 'p.',
      limits: { maxValueChars: CONTEXT_LIMITS.maxCharsPerMessage },
    },
  ] as KvDomainDescriptor[]));
}

/** 真实装配：createOperatorRegistry + createBasicPrimitives，只把最底层 fetchImpl 换成计数桩。
 * 这样 display / web_fetch 的 execute→run 转换、schema 校验、effects 收集全部走产品代码，
 * 不再手搓 OperatorSpec（手搓会把 SkillPrimitive 当 OperatorSpec 用，display 静默失效）。 */
async function buildRegistry(fetchCalls: string[]): Promise<OperatorRegistry> {
  const body = JSON.stringify({
    current_condition: [{ temp_C: '26' }],
    weather: [{ maxtempC: '29' }],
  });
  const fetchStub = (async (input: unknown) => {
    fetchCalls.push(String(input));
    return {
      status: 200, statusText: 'OK', ok: true,
      headers: { get: () => 'application/json' },
      text: async () => body,
    };
  }) as unknown as typeof fetch;
  // proxyUrl 用占位域名：真实 executeWebFetch 会把待取 URL 编码进 query，
  // 断言里比对的仍是 args['url']（见 fetchCalls 里的 wttr.in URL）。
  const primitives = createBasicPrimitives({
    proxyUrl: 'https://proxy.invalid', timeoutMs: 15000, fetchImpl: fetchStub,
  });
  return createOperatorRegistry({
    primitives,
    hostOperators: [...createHostWorkflowOperators(), ...createWorkflowStorageOperators(makeKv())],
    artifacts: { listActive: async () => [] } as unknown as PluginArtifactService,
    runtime: {
      run: async () => { throw new Error('no plugin'); },
      dispose: async () => {},
    } as unknown as IPluginRuntime,
  });
}

describe.skipIf(!assetsAvailable)('weather.wttr v8 执行链路', () => {
  it('配方是 workflow-only 且版本为 8', () => {
    const r = loadRecipe();
    expect(r.version).toBe(8);
    const calls = new Set<string>();
    const walk = (x: unknown): void => {
      if (typeof x !== 'object' || x === null) return;
      if (Array.isArray(x)) { x.forEach(walk); return; }
      const rec = x as Record<string, unknown>;
      if (typeof rec['call'] === 'string') calls.add(rec['call']);
      Object.values(rec).forEach(walk);
    };
    walk(r.workflow);
    expect(calls).toContain('web_fetch');
    expect(calls).toContain('storage.get');
  });

  it('operation=weatherBatch 真的发起 wttr.in 请求（URL 模板 / 分派都通）', async () => {
    const recipe = loadRecipe();
    const calls: string[] = [];
    // ★ 城市名字符串数组：模型看到 `cities: array` 时最自然的填法。
    // v5 用 {{urlencode.item.slug}}、v6 用 {{urlencode.item.city}}，都要求 item 是
    // 对象；真实用户输入「茂名天气」时模型填的是 ['茂名']，item 是字符串，
    // 取 .city 失败 → onError:continue 静默跳过 → DAG ok:true 却零请求（用户实测
    // 连 api.weiqi.lol 都没有）。v7 改用 {{urlencode.item}} 直接取整个字符串元素。
    const result = await runWorkflow(
      recipe.workflow,
      { operation: 'weatherBatch', cities: ['深圳'], format: 'j2' },
      await buildRegistry(calls),
      undefined,
      recipe.inputs,
    );
    expect(result.ok).toBe(true);
    expect(result.failure).toBeUndefined();
    // 真实 createBasicPrimitives.executeWebFetch 把目标 URL 编码进代理 query。
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('https%3A%2F%2Fwttr.in%2F');
    expect(decodeURIComponent(calls[0] ?? '')).toContain('wttr.in/%E6%B7%B1%E5%9C%B3?format=j2');
    expect(result.completedStepIds.join('|')).toContain('batch_fetch');
    // batch_loop 带 yield:true 且位于 dispatch_3.then 分支内：分支内 yield 必须
    // 透传到 values，否则 returnToLLM 写进缓存的恒为 '【yield 汇总 values】\n{}'（20 字符），
    // 模型 workflow_result_read 读回空对象，只能答「没有数据 / 未访问网络」。
    const loop = result.values['batch_loop'] as unknown[] | undefined;
    expect(Array.isArray(loop)).toBe(true);
    expect(loop?.[0]).toMatchObject({ ok: true, value: { city: '深圳' } });
  });

  it('只给 operation 时不能静默成功（缺 cities 必须结构化失败）', async () => {
    const recipe = loadRecipe();
    const calls: string[] = [];
    const result = await runWorkflow(
      recipe.workflow,
      { operation: 'weatherBatch' },
      await buildRegistry(calls),
      undefined,
      recipe.inputs,
    );
    expect(result.ok).toBe(false);
    expect(result.failure?.error).toContain('{{input.cities}}');
    expect(calls).toEqual([]);
  });

  it('operation=storageGet 不串到天气分支', async () => {
    const recipe = loadRecipe();
    const calls: string[] = [];
    const result = await runWorkflow(
      recipe.workflow,
      { operation: 'storageGet', key: 'weather.defaultCity' },
      await buildRegistry(calls),
      undefined,
      recipe.inputs,
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([]);
    expect(result.completedStepIds.join('|')).not.toContain('batch_fetch');
  });
});





// v8：链接由 DAG 的 display 节点产出（数据旁路），不靠模型自己贴。
// weatherBatch（查指定城市）→ 每个城市一条 prefs-add 链接；
// weatherWatchlist（查自选列表天气）→ 已在自选里，零链接。
describe.skipIf(!assetsAvailable)('v8 links: weatherBatch 才显示加入自选链接', () => {
  function linksOf(result: { effects?: readonly { displayMarkdown?: string }[] }): string[] {
    return (result.effects ?? [])
      .filter((e) => typeof e.displayMarkdown === 'string')
      .map((e) => e.displayMarkdown as string);
  }

  it('weatherBatch 产出每个城市的 prefs-add 链接', async () => {
    const recipe = loadRecipe();
    const calls: string[] = [];
    const result = await runWorkflow(
      recipe.workflow,
      { operation: 'weatherBatch', cities: ['茂名'], format: 'j2' },
      await buildRegistry(calls), undefined, recipe.inputs, true,
    );
    expect(result.ok).toBe(true);
    // 真实 web_fetch 把 URL 编进代理 query，桩收到的是代理 URL；只断言确实发起了一次。
    expect(calls).toHaveLength(1);
    const links = linksOf(result);
    expect(links).toHaveLength(1);
    expect(links[0]).toBe('[加入自选城市：茂名](prefs-add:prefs:weather.watchlist:茂名)');
  });

  it('weatherWatchlist 取数但不显示加入自选链接', async () => {
    const recipe = loadRecipe();
    const calls: string[] = [];
    const result = await runWorkflow(
      recipe.workflow,
      { operation: 'weatherWatchlist', cities: ['茂名'], format: 'j2' },
      await buildRegistry(calls), undefined, recipe.inputs, true,
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(linksOf(result)).toHaveLength(0);
  });
});
