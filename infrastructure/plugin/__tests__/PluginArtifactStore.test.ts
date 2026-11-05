/**
 * 工件存储端口的行为测试
 *
 * 按约定用 InMemoryPluginArtifactStore 验证 IPluginArtifactStore 的等价语义，
 * 不引入 jsdom / fake-indexeddb / 任何浏览器 API。
 * PluginArtifactStore（IndexedDB 版）与 InMemory 版共用
 * clone / merge / sort 纯函数，因此这份测试覆盖的是两种实现共同的契约。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { PluginArtifact, PluginSpec } from '../../../domain/plugin/types';
import {
  InMemoryPluginArtifactStore,
  type PluginArtifactPersistence,
} from '../InMemoryPluginArtifactStore';

function makeSpec(): PluginSpec {
  return {
    pointId: 'ranking.tiebreak',
    version: 1,
    entry: 'rank',
    hostApi: [],
    limits: {
      timeoutMs: 2000,
      memoryBytes: 32 * 1024 * 1024,
      maxStackBytes: 512 * 1024,
      maxCodeBytes: 32 * 1024,
      maxOutputBytes: 256 * 1024,
      maxLogs: 50,
    },
  };
}

function makeArtifact(overrides: Partial<PluginArtifact> = {}): PluginArtifact {
  const base: PluginArtifact = {
    id: 'plugin:1000:aaa',
    name: '同分排序',
    pointId: 'ranking.tiebreak',
    version: 1,
    enabled: false,
    origin: 'llm',
    intent: '按对手分排序，同分时比较连胜',
    code: 'export function rank(input) { return input; }',
    spec: makeSpec(),
    createdAt: 1000,
    updatedAt: 1000,
    history: [
      { version: 1, code: 'v1', at: 1000, trigger: 'create', outcome: 'accepted' },
    ],
  };
  return { ...base, ...overrides };
}

let persistence: PluginArtifactPersistence;
let store: InMemoryPluginArtifactStore;

beforeEach(() => {
  persistence = new Map<string, string>();
  store = new InMemoryPluginArtifactStore(persistence);
});

describe('create / get / list / remove', () => {
  it('写入后可读回完整工件（含 spec / history / 可选字段）', async () => {
    const artifact = makeArtifact({
      scope: { eventId: 42 },
      conversationRef: 'conv-原始会话',
    });
    await store.create(artifact);

    const got = await store.get(artifact.id);
    expect(got).toEqual(artifact);
    expect(got?.spec.hostApi).toEqual([]);
    expect(got?.history[0]?.trigger).toBe('create');
    expect(got?.scope?.eventId).toBe(42);
    expect(got?.conversationRef).toBe('conv-原始会话');
  });

  it('list 返回全部工件，按 updatedAt 降序', async () => {
    await store.create(makeArtifact({ id: 'a', updatedAt: 100 }));
    await store.create(makeArtifact({ id: 'b', updatedAt: 300 }));
    await store.create(makeArtifact({ id: 'c', updatedAt: 200 }));

    const list = await store.list();
    expect(list.map((a) => a.id)).toEqual(['b', 'c', 'a']);
  });

  it('get 不存在的 id 返回 null；remove 后不可读', async () => {
    expect(await store.get('missing')).toBeNull();
    await store.create(makeArtifact());
    await store.remove('plugin:1000:aaa');
    expect(await store.get('plugin:1000:aaa')).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('重复 create 抛错；update 不存在的 id 抛错', async () => {
    await store.create(makeArtifact());
    await expect(store.create(makeArtifact())).rejects.toThrow(/already exists/);
    await expect(store.update('nope', { name: 'x' })).rejects.toThrow(/not found/);
  });

  it('返回值是深拷贝，外部修改不会污染存储', async () => {
    const artifact = makeArtifact();
    await store.create(artifact);
    const got = await store.get(artifact.id);
    expect(got).not.toBeNull();
    if (got !== null) {
      got.intent = '被外部改坏';
      got.spec.hostApi.push('danger');
      got.history[0]!.code = 'tampered';
    }
    artifact.code = '调用方自己改了入参';

    const fresh = await store.get(artifact.id);
    expect(fresh?.intent).toBe('按对手分排序，同分时比较连胜');
    expect(fresh?.spec.hostApi).toEqual([]);
    expect(fresh?.history[0]?.code).toBe('v1');
    expect(fresh?.code).toBe('export function rank(input) { return input; }');
  });
});

describe('update：Partial 合并语义', () => {
  it('只改一个字段，intent / spec / history / scope / conversationRef 全保留', async () => {
    const artifact = makeArtifact({
      scope: { eventId: 7 },
      conversationRef: 'conv-1',
    });
    await store.create(artifact);

    await store.update(artifact.id, { code: 'v2 全量代码', version: 2, enabled: true });

    const got = await store.get(artifact.id);
    expect(got?.code).toBe('v2 全量代码');
    expect(got?.version).toBe(2);
    expect(got?.enabled).toBe(true);
    expect(got?.intent).toBe(artifact.intent);
    expect(got?.spec).toEqual(artifact.spec);
    expect(got?.history).toEqual(artifact.history);
    expect(got?.scope).toEqual({ eventId: 7 });
    expect(got?.conversationRef).toBe('conv-1');
    expect(got?.origin).toBe('llm');
    expect(got?.createdAt).toBe(1000);
  });

  it('history 整体替换后仍完整保留，旧版本快照不丢', async () => {
    const artifact = makeArtifact();
    await store.create(artifact);
    const nextHistory = [
      ...artifact.history,
      {
        version: 2,
        code: 'v2',
        at: 2000,
        trigger: 'auto-repair' as const,
        feedback: '输出不是数组',
        outcome: 'rejected' as const,
      },
    ];
    await store.update(artifact.id, { history: nextHistory, code: 'v2', updatedAt: 2000 });

    const got = await store.get(artifact.id);
    expect(got?.history).toHaveLength(2);
    expect(got?.history[0]?.code).toBe('v1');
    expect(got?.history[1]?.feedback).toBe('输出不是数组');
    expect(got?.history[1]?.outcome).toBe('rejected');
  });

  it('exactOptionalPropertyTypes：patch 里显式 undefined 不覆盖已有值，也不写入 undefined 属性', async () => {
    const artifact = makeArtifact({ conversationRef: 'conv-keep' });
    await store.create(artifact);

    // 模拟调用方用运行时对象绕过类型约束（例如 JSON.parse / any 边界）
    const patch = {
      intent: undefined,
      scope: undefined,
      conversationRef: undefined,
      name: '改名',
    } as unknown as Partial<PluginArtifact>;
    await store.update(artifact.id, patch);

    const got = await store.get(artifact.id);
    expect(got?.name).toBe('改名');
    expect(got?.intent).toBe(artifact.intent);
    expect(got?.conversationRef).toBe('conv-keep');
    expect(Object.prototype.hasOwnProperty.call(got, 'scope')).toBe(false);
    expect(Object.keys(got ?? {})).not.toContain('scope');
  });

  it('patch 不能改 id（keyPath），避免留下孤儿记录', async () => {
    const artifact = makeArtifact();
    await store.create(artifact);
    const patch = { id: 'plugin:evil', name: 'x' } as Partial<PluginArtifact>;
    await store.update(artifact.id, patch);

    expect(await store.get('plugin:evil')).toBeNull();
    expect((await store.get(artifact.id))?.name).toBe('x');
  });
});

describe('会话清空后工件仍可读可改', () => {
  it('丢弃 store 实例、只保留持久化 Map，新建 store 后完整续用', async () => {
    const artifact = makeArtifact({
      scope: { eventId: 99 },
      conversationRef: '会话-已清空',
    });
    await store.create(artifact);

    // 模拟：聊天会话状态被整体清空，只剩底层持久化介质
    const revived = new InMemoryPluginArtifactStore(persistence);
    const got = await revived.get(artifact.id);
    expect(got).toEqual(artifact);
    expect(got?.conversationRef).toBe('会话-已清空');

    await revived.update(artifact.id, { code: '清空会话后修订', version: 3 });
    const after = await revived.get(artifact.id);
    expect(after?.code).toBe('清空会话后修订');
    expect(after?.version).toBe(3);
    expect(after?.intent).toBe(artifact.intent);
    expect(after?.spec).toEqual(artifact.spec);
    expect(after?.history).toEqual(artifact.history);
    expect((await revived.list())[0]?.id).toBe(artifact.id);
  });

  it('新建另一个 store 实例共享同一持久化 Map 时能看到同一份数据', async () => {
    await store.create(makeArtifact({ id: 'shared' }));
    const other = new InMemoryPluginArtifactStore(persistence);
    expect(await other.get('shared')).not.toBeNull();
    await other.remove('shared');
    expect(await store.get('shared')).toBeNull();
  });

  it('读回脏数据时报错，不静默产出半截工件（区别于 ConfigStorageAdapter.import）', async () => {
    await store.create(makeArtifact());
    persistence.set('plugin:1000:aaa', JSON.stringify({ id: 'plugin:1000:aaa' }));
    await expect(store.get('plugin:1000:aaa')).rejects.toThrow(/Corrupted plugin artifact/);
    await expect(store.list()).rejects.toThrow(/Corrupted plugin artifact/);
  });
});
