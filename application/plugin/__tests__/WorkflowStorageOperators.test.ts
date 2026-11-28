/**
 * Workflow 宿主 storage.* 算子契约测试。
 *
 * 锁住的边界：算子只是 KvService 的薄适配层，不另起一套存储实现——
 * 域可见性 / 写入权限 / 键校验 / 序列化 / 物理键映射全部复用既有策略。
 * 用 MemoryKvDriver 覆盖全部策略分支（与 LocalStorage / IndexedDB 行为逐字一致）。
 */
import { describe, it, expect } from 'vitest';
import { CONTEXT_LIMITS } from '@application/chat/ConversationPrompt';
import { createWorkflowStorageOperators } from '../WorkflowStorageOperators';
import { KvService } from '@application/skill/kv/KvService';
import { KvDomainRegistry } from '@application/skill/kv/KvDomains';
import { MemoryKvDriver } from '@application/skill/kv/KvDrivers';
import type { KvDomainDescriptor } from '@application/skill/kv/KvTypes';
import type { OperatorSpec } from '@domain/plugin/types';

function makeKv(): KvService {
  return new KvService(new KvDomainRegistry([
    {
      name: 'prefs', summary: '偏好', driver: new MemoryKvDriver({ id: 'mem-prefs' }),
      visibility: 'readable', writableBy: 'model', physicalPrefix: 'p.',
      limits: { maxValueChars: CONTEXT_LIMITS.maxCharsPerMessage },
    },
    {
      name: 'secrets', summary: '敏感', driver: new MemoryKvDriver({ id: 'mem-secrets' }),
      visibility: 'opaque', writableBy: 'host', physicalPrefix: 's.',
    },
    {
      name: 'checkpoints', summary: '宿主内部检查点', driver: new MemoryKvDriver({ id: 'mem-cp' }),
      visibility: 'readable', writableBy: 'host', physicalPrefix: 'c.',
    },
  ] as KvDomainDescriptor[]));
}

function operatorMap(kv: KvService): ReadonlyMap<string, OperatorSpec> {
  return new Map(createWorkflowStorageOperators(kv).map((op) => [op.name, op]));
}

/** OperatorSpec.run 统一包成 { value }，取回纯值便于断言 */
async function run(op: OperatorSpec, args: Record<string, unknown>): Promise<unknown> {
  return (await op.run(args)).value;
}

describe('createWorkflowStorageOperators — 注册契约', () => {
  it('只暴露 storage.get / set / delete 三个宿主算子，schema 与幂等性固定', () => {
    const ops = createWorkflowStorageOperators(makeKv());
    expect(ops.map((o) => o.name)).toEqual(['storage.get', 'storage.set', 'storage.delete']);
    const byName = new Map(ops.map((o) => [o.name, o]));
    expect(byName.get('storage.get')?.idempotent).toBe(true);
    expect(byName.get('storage.set')?.idempotent).toBe(false);
    expect(byName.get('storage.delete')?.idempotent).toBe(true);
    for (const op of ops) {
      expect(op.kind).toBe('io');
      expect(op.inputSchema['type']).toBe('object');
      expect(op.inputSchema['additionalProperties']).toBe(false);
    }
    expect(byName.get('storage.set')?.inputSchema['required']).toEqual(['domain', 'key', 'value']);
  });
});

describe('storage.get / set / delete — 正常路径', () => {
  it('缺失键返回 null；写入后可读；删除后回到 null；重复删除不报错', async () => {
    const ops = operatorMap(makeKv());
    const get = ops.get('storage.get')!;
    const set = ops.get('storage.set')!;
    const del = ops.get('storage.delete')!;

    expect(await run(get, { domain: 'prefs', key: 'weather.watchlist' })).toBe(null);
    expect(await run(set, { domain: 'prefs', key: 'weather.watchlist', value: ['北京', '上海'] }))
      .toEqual(['北京', '上海']);
    expect(await run(get, { domain: 'prefs', key: 'weather.watchlist' }))
      .toEqual(['北京', '上海']);
    expect(await run(del, { domain: 'prefs', key: 'weather.watchlist' })).toBe(true);
    expect(await run(get, { domain: 'prefs', key: 'weather.watchlist' })).toBe(null);
    expect(await run(del, { domain: 'prefs', key: 'weather.watchlist' })).toBe(true);
  });

  it('写入复用 KvService 序列化：对象 / 数组 / null 原样往返', async () => {
    const ops = operatorMap(makeKv());
    const get = ops.get('storage.get')!;
    const set = ops.get('storage.set')!;
    const values: unknown[] = [
      { city: '北京', days: [1, 2, 3] },
      ['a', { b: 2 }],
      0,
      false,
      '',
    ];
    for (const [i, value] of values.entries()) {
      expect(await run(set, { domain: 'prefs', key: `k${i}`, value })).toEqual(value);
      expect(await run(get, { domain: 'prefs', key: `k${i}` })).toEqual(value);
    }
  });
});

describe('storage.* — 域策略与参数校验（不绕过 KvService）', () => {
  it('opaque 域 secrets 读 / 写 / 删一律拒绝，绝不回显值', async () => {
    const kv = makeKv();
    const ops = operatorMap(kv);
    // 宿主专用接口先放一份明文，确认 storage.get 不会把它带出来
    await kv.put('secrets', 'token', 'super-secret');
    await expect(run(ops.get('storage.get')!, { domain: 'secrets', key: 'token' }))
      .rejects.toThrow(/不允许 Workflow 读取/);
    await expect(run(ops.get('storage.set')!, { domain: 'secrets', key: 'token', value: 'x' }))
      .rejects.toThrow(/不允许 Workflow 读取/);
    await expect(run(ops.get('storage.delete')!, { domain: 'secrets', key: 'token' }))
      .rejects.toThrow(/不允许 Workflow 读取/);
    expect(await kv.readRaw('secrets', 'token')).toBe('super-secret');
  });

  it('host-only 域 checkpoints 可读，但模型写入 / 删除被 KvService 拒绝', async () => {
    const kv = makeKv();
    const ops = operatorMap(kv);
    await kv.put('checkpoints', 'session-1', { summary: '宿主内部' });
    expect(await run(ops.get('storage.get')!, { domain: 'checkpoints', key: 'session-1' }))
      .toEqual({ summary: '宿主内部' });
    await expect(run(ops.get('storage.set')!, { domain: 'checkpoints', key: 'session-1', value: 'x' }))
      .rejects.toThrow(/模型不可写/);
    await expect(run(ops.get('storage.delete')!, { domain: 'checkpoints', key: 'session-1' }))
      .rejects.toThrow(/模型不能删除|模型不可删/);
    expect(await kv.readRaw('checkpoints', 'session-1')).toEqual({ summary: '宿主内部' });
  });

  it('未知域、非法 key、缺参都给出明确报错', async () => {
    const ops = operatorMap(makeKv());
    const get = ops.get('storage.get')!;
    await expect(run(get, { domain: 'nope', key: 'k' })).rejects.toThrow(/未知存储域/);
    await expect(run(get, { domain: 'prefs', key: '../escape' })).rejects.toThrow(/key 不合法/);
    await expect(run(get, { domain: 'prefs' })).rejects.toThrow(/key 必须是非空字符串/);
    await expect(run(get, { key: 'k' })).rejects.toThrow(/domain 必须是非空字符串/);
    await expect(run(ops.get('storage.set')!, { domain: 'prefs', key: 'k' }))
      .rejects.toThrow(/value 不可序列化/);
  });

  it('写超长值沿用 prefs 既有配额（CONTEXT_LIMITS.maxCharsPerMessage），不自造阈值', async () => {
    const ops = operatorMap(makeKv());
    const set = ops.get('storage.set')!;
    await expect(run(set, {
      domain: 'prefs', key: 'too-long', value: 'x'.repeat(CONTEXT_LIMITS.maxCharsPerMessage + 1),
    })).rejects.toThrow();
  });
});
