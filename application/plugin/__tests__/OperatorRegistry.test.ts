/**
 * 宿主统一算子表契约测试（阶段三整改）
 *
 * 验收点：
 * - 插件算子命名空间（slug）唯一权威来源是 catalogRef.resourceId，不是生成式的 artifact.id；
 *   在线安装的 workflow-operator.calc 必须注册成 calc.add 等，配方才能命中。
 * - ranking 工件编进同一套算子表：单入口 rank(input)、按资源 id 全名注册。
 * - 禁用工件不进表；未注册算子执行抛明确错误；插件与内置同名时插件覆盖。
 *
 * 纯内存假工件 + 假 runtime，不依赖 QuickJS / IndexedDB / 网络。
 */

import { describe, it, expect, vi } from 'vitest';
import { createOperatorRegistry, type OperatorRegistryDeps } from '../OperatorRegistry';
import {
  WORKFLOW_OPERATOR_POINT_ID, WORKFLOW_OPERATOR_SPEC,
  RANKING_POINT_ID, RANKING_SPEC,
  type IPluginRuntime, type PluginArtifact, type PluginRunResult,
} from '@domain/plugin/types';
import type { SkillPrimitive } from '@application/skill/SkillTypes';
import type { PluginArtifactService } from '../PluginArtifactService';

const CODE = 'function call(input){ return 1 } function rank(input){ return 1 }';

/** 成功沙箱结果；output 是算子 run 的 value 来源 */
const okRun = (output: unknown): PluginRunResult =>
  ({ ok: true, output, logs: [], elapsedMs: 1 });

/**
 * 构造完整工件；exactOptionalPropertyTypes 下可选字段只在真有值时写入，
 * 绝不塞 undefined。
 */
function makeArtifact(
  patch: Partial<PluginArtifact> & Pick<PluginArtifact, 'id' | 'pointId' | 'spec' | 'enabled'>,
): PluginArtifact {
  return {
    id: patch.id,
    name: patch.name ?? '测试工件',
    pointId: patch.pointId,
    version: patch.version ?? 1,
    enabled: patch.enabled,
    origin: patch.origin ?? 'llm',
    intent: patch.intent ?? '测试',
    code: patch.code ?? CODE,
    spec: patch.spec,
    createdAt: patch.createdAt ?? 1,
    updatedAt: patch.updatedAt ?? 1,
    history: patch.history ?? [],
    ...(patch.catalogRef !== undefined ? { catalogRef: patch.catalogRef } : {}),
    ...(patch.operatorContract !== undefined ? { operatorContract: patch.operatorContract } : {}),
  };
}

/** 在线安装件的生成式 id（真实形状：plugin:<ts>:<random>） */
const GENERATED_ID = 'plugin:1700000000000:abc123';

const CALC_EXPOSES = ['add', 'subtract', 'multiply', 'divide'].map((name) => ({
  name, description: `计算 ${name}`,
  inputSchema: { type: 'object' }, outputSchema: {}, kind: 'pure' as const, idempotent: true,
}));

/** 假工件服务：listActive 按真实语义只给「已启用」工件（人工启用闸门） */
function fakeArtifacts(all: PluginArtifact[]): PluginArtifactService {
  return {
    listActive: vi.fn(async () => all.filter((a) => a.enabled)),
  } as unknown as PluginArtifactService;
}

/** 假沙箱：run 可注入结果；不碰 QuickJS / Worker */
function fakeRuntime(result: PluginRunResult = okRun('PLUGIN_VALUE')): IPluginRuntime & {
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async () => result);
  return {
    run,
    dispose: vi.fn(async () => undefined),
  } as unknown as IPluginRuntime & { run: ReturnType<typeof vi.fn> };
}

/** 内置假原语：execute 用 spy，返回可辨识的 value，用于同名覆盖断言 */
function fakePrimitive(
  name: string, value: unknown,
): SkillPrimitive & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({ observation: '内置', ok: true, detail: '内置', value }));
  return {
    name,
    definition: { name, description: '内置假原语', parameters: { type: 'object' } },
    idempotent: true,
    outputSchema: {},
    kind: 'pure',
    execute,
  };
}

function deps(
  all: PluginArtifact[],
  runtime: IPluginRuntime,
  primitives: SkillPrimitive[] = [],
): OperatorRegistryDeps {
  return { primitives, artifacts: fakeArtifacts(all), runtime };
}

describe('createOperatorRegistry：结构化参数与 Schema 边界', () => {
  it('把同一个原生参数对象传给内置原语，不做 JSON 往返', async () => {
    const primitive = fakePrimitive('identity', null);
    const registry = await createOperatorRegistry(deps([], fakeRuntime(), [primitive]));
    const args = { nested: { value: 7 } };
    await registry.run('identity', args);
    expect(primitive.execute).toHaveBeenCalledWith(args);
  });

  it('输入不符合 Schema 时不执行原语', async () => {
    const execute = vi.fn(async () => ({ observation: 'x', ok: true, detail: 'x', value: null }));
    const primitive: SkillPrimitive = {
      name: 'required_input',
      definition: {
        name: 'required_input', description: 'required',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
      },
      idempotent: true,
      outputSchema: {},
      kind: 'pure',
      execute,
    };
    const registry = await createOperatorRegistry(deps([], fakeRuntime(), [primitive]));
    await expect(registry.run('required_input', {})).rejects.toThrow('输入校验失败');
    expect(execute).not.toHaveBeenCalled();
  });

  it('原语失败时保留结构化观察，不把缺失 value 误报为输出 Schema 错误', async () => {
    const primitive: SkillPrimitive = {
      name: 'failed_string_output',
      definition: { name: 'failed_string_output', description: 'failed', parameters: { type: 'object' } },
      idempotent: true,
      kind: 'pure',
      outputSchema: { type: 'string' },
      execute: async () => ({
        observation: 'regex_extract：正则执行失败。没有产出 value。',
        ok: false,
        detail: '正则执行失败',
      }),
    };
    const registry = await createOperatorRegistry(deps([], fakeRuntime(), [primitive]));
    const failure = await registry.run('failed_string_output', {}).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    );
    expect(failure.message).toContain('regex_extract：正则执行失败');
    expect(failure.message).not.toContain('输出校验失败');
  });

  it('算子输出不符合 Schema 时拒绝结果', async () => {
    const primitive: SkillPrimitive = {
      name: 'string_output',
      definition: { name: 'string_output', description: 'output', parameters: { type: 'object' } },
      idempotent: true,
      kind: 'pure',
      outputSchema: { type: 'string' },
      execute: async () => ({ observation: 'x', ok: true, detail: 'x', value: { wrong: true } }),
    };
    const registry = await createOperatorRegistry(deps([], fakeRuntime(), [primitive]));
    await expect(registry.run('string_output', {})).rejects.toThrow('输出校验失败');
  });
});

describe('createOperatorRegistry：插件算子命名空间与 ranking 分派', () => {
  it('① catalog 装 calc：4 个方法按 catalogRef.resourceId 注册，不含生成式 id', async () => {
    const artifact = makeArtifact({
      id: GENERATED_ID,
      pointId: WORKFLOW_OPERATOR_POINT_ID,
      spec: WORKFLOW_OPERATOR_SPEC,
      enabled: true,
      origin: 'manual',
      catalogRef: { registryUrl: 'https://example.com/registry.json', resourceId: 'workflow-operator.calc' },
      operatorContract: { exposes: CALC_EXPOSES, smoke: [] },
    });
    const runtime = fakeRuntime();
    const registry = await createOperatorRegistry(deps([artifact], runtime));

    const names = [...registry.specs.keys()];
    expect(names).toEqual([
      'calc.add', 'calc.subtract', 'calc.multiply', 'calc.divide',
    ]);
    expect(names.some((n) => n.startsWith('plugin:'))).toBe(false);
    expect(registry.get('calc.divide')?.idempotent).toBe(true);

    // workflow-operator 沿用既有 call({method,args:[args]}) 输入 + 工件自带 spec
    const out = await registry.run('calc.divide', { a: 2026, b: 11 });
    expect(out.value).toBe('PLUGIN_VALUE');
    expect(runtime.run).toHaveBeenCalledWith(
      CODE,
      { method: 'divide', args: [{ a: 2026, b: 11 }] },
      WORKFLOW_OPERATOR_SPEC,
    );
  });

  it('② LLM 自建件（无 catalogRef）：注册名用完整 artifact.id，不猜 calc', async () => {
    const artifact = makeArtifact({
      id: GENERATED_ID,
      pointId: WORKFLOW_OPERATOR_POINT_ID,
      spec: WORKFLOW_OPERATOR_SPEC,
      enabled: true,
      operatorContract: { exposes: [{ name: 'foo', description: 'foo', inputSchema: { type: 'object' }, outputSchema: {}, kind: 'pure', idempotent: true }], smoke: [] },
    });
    const registry = await createOperatorRegistry(deps([artifact], fakeRuntime()));

    expect(registry.get(`${GENERATED_ID}.foo`)).toBeDefined();
    expect(registry.get('calc.foo')).toBeUndefined();
    expect([...registry.specs.keys()]).toEqual([`${GENERATED_ID}.foo`]);
  });

  it('③ catalog 装 ranking：按资源 id 全名注册，args 原样透给 rank(input)，value=output', async () => {
    const artifact = makeArtifact({
      id: 'plugin:1700000000001:def456',
      pointId: RANKING_POINT_ID,
      spec: RANKING_SPEC,
      enabled: true,
      origin: 'manual',
      catalogRef: { registryUrl: 'https://example.com/registry.json', resourceId: 'ranking.total-score' },
    });
    const rankingOutput = { columns: [], rows: [] };
    const runtime = fakeRuntime(okRun(rankingOutput));
    const registry = await createOperatorRegistry(deps([artifact], runtime));

    expect(registry.get('ranking.total-score')).toBeDefined();
    expect(registry.get('ranking.total-score')?.idempotent).toBe(true);
    expect(registry.get('ranking.ranking.total-score')).toBeUndefined(); // 不重复拼前缀

    const args = { matches: [] };
    const out = await registry.run('ranking.total-score', args);
    expect(out.value).toBe(rankingOutput);
    // rank(input) 入口：input 就是 args 本身，不包 {method,args:[...]}；spec 用 RANKING_SPEC
    expect(runtime.run).toHaveBeenCalledWith(CODE, args, RANKING_SPEC);
  });

  it('④ 禁用工件不进表；未注册算子 run 抛明确错误', async () => {
    const disabled = makeArtifact({
      id: GENERATED_ID,
      pointId: WORKFLOW_OPERATOR_POINT_ID,
      spec: WORKFLOW_OPERATOR_SPEC,
      enabled: false,
      catalogRef: { registryUrl: 'https://example.com/registry.json', resourceId: 'workflow-operator.calc' },
      operatorContract: { exposes: CALC_EXPOSES, smoke: [] },
    });
    const runtime = fakeRuntime();
    const registry = await createOperatorRegistry(deps([disabled], runtime));

    expect(registry.get('calc.divide')).toBeUndefined();
    expect(registry.specs.size).toBe(0);
    await expect(registry.run('不存在的算子', {})).rejects.toThrow('未注册的算子：不存在的算子');
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it('⑥ 内置算子与插件同名时插件覆盖（沿用既有 Map 口径）', async () => {
    const artifact = makeArtifact({
      id: GENERATED_ID,
      pointId: WORKFLOW_OPERATOR_POINT_ID,
      spec: WORKFLOW_OPERATOR_SPEC,
      enabled: true,
      catalogRef: { registryUrl: 'https://example.com/registry.json', resourceId: 'workflow-operator.calc' },
      operatorContract: { exposes: [{ name: 'divide', description: 'divide', inputSchema: { type: 'object' }, outputSchema: {}, kind: 'pure', idempotent: true }], smoke: [] },
    });
    const builtin = fakePrimitive('calc.divide', 'BUILTIN_VALUE');
    const runtime = fakeRuntime(okRun('PLUGIN_VALUE'));
    const registry = await createOperatorRegistry(deps([artifact], runtime, [builtin]));

    expect(registry.specs.get('calc.divide')?.idempotent).toBe(true);
    const out = await registry.run('calc.divide', {});
    expect(out.value).toBe('PLUGIN_VALUE'); // 插件覆盖内置
    expect(builtin.execute).not.toHaveBeenCalled();
    expect(runtime.run).toHaveBeenCalled();
  });
});
