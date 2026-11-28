/**
 * 天气技能 v6「装好后确实能取数」的回归测试。
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
import type { OperatorSpec, StepResult } from '@domain/plugin/types';
import type { OperatorRegistry } from '@application/plugin/OperatorRegistry';
import type { WorkflowSpec, WorkflowInput } from '@application/skill/SkillTypes';
import { runWorkflow } from '@application/skill/WorkflowRunner';
import { createHostWorkflowOperators } from '@application/plugin/HostWorkflowOperators';
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

/** web_fetch 是唯一会出网的算子，用桩计数；其余全部用真实宿主算子。 */
function buildRegistry(fetchCalls: string[]): OperatorRegistry {
  const specs = new Map<string, OperatorSpec>();
  for (const op of [...createHostWorkflowOperators(), ...createWorkflowStorageOperators(makeKv())]) {
    specs.set(op.name, op);
  }
  const fetchSpec: OperatorSpec = {
    name: 'web_fetch', description: '天气请求计数桩',
    inputSchema: { type: 'object' }, outputSchema: {}, kind: 'io', idempotent: false,
    run: async (args): Promise<StepResult> => {
      fetchCalls.push(String(args['url']));
      return {
        value: {
          current_condition: [{ temp_C: '26' }],
          weather: [{ maxtempC: '29' }],
        },
      };
    },
  };
  specs.set(fetchSpec.name, fetchSpec);
  return {
    specs,
    get: (name: string) => specs.get(name),
    run: async (name: string, args: Record<string, unknown>) => {
      const op = specs.get(name);
      if (!op) throw new Error(`未注册的算子：${name}`);
      return op.run(args);
    },
  } as unknown as OperatorRegistry;
}

describe.skipIf(!assetsAvailable)('weather.wttr v6 执行链路', () => {
  it('配方是 workflow-only 且版本为 6', () => {
    const r = loadRecipe();
    expect(r.version).toBe(7);
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
      buildRegistry(calls),
      undefined,
      recipe.inputs,
    );
    expect(result.ok).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(calls).toEqual(['https://wttr.in/%E6%B7%B1%E5%9C%B3?format=j2']);
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
      buildRegistry(calls),
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
      buildRegistry(calls),
      undefined,
      recipe.inputs,
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([]);
    expect(result.completedStepIds.join('|')).not.toContain('batch_fetch');
  });
});




