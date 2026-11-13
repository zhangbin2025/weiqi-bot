/**
 * 工件生命周期纯逻辑测试
 * 用 InMemory 存储 + 可注入时钟，不依赖任何浏览器 API。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { PluginArtifact, PluginSpec } from '../../../domain/plugin/types';
import {
  InMemoryPluginArtifactStore,
  type PluginArtifactPersistence,
} from '../../../infrastructure/plugin/InMemoryPluginArtifactStore';
import {
  PluginArtifactService,
  type CreatePluginArtifactInput,
} from '../PluginArtifactService';

function makeSpec(): PluginSpec {
  return {
    pointId: 'ranking',
    version: 1,
    entry: 'rank',
    hostApi: ['log'],
    limits: {
      timeoutMs: 2000,
      memoryBytes: 1024,
      maxStackBytes: 512,
      maxCodeBytes: 2048,
      maxOutputBytes: 4096,
      maxLogs: 10,
    },
  };
}

function makeInput(overrides: Partial<CreatePluginArtifactInput> = {}): CreatePluginArtifactInput {
  return {
    name: '同分排序插件',
    intent: '同分时按对手分和连胜排序',
    code: 'export function rank(x) { return x; }',
    pointId: 'ranking',
    origin: 'llm',
    spec: makeSpec(),
    ...overrides,
  };
}

let now: number;
let persistence: PluginArtifactPersistence;
let store: InMemoryPluginArtifactStore;
let service: PluginArtifactService;

beforeEach(() => {
  now = 1_700_000_000_000;
  persistence = new Map<string, string>();
  store = new InMemoryPluginArtifactStore(persistence);
  service = new PluginArtifactService(store, () => now);
});

describe('create', () => {
  it('生成 plugin:<timestamp>:<random> id，version=1，history 一条 create', async () => {
    const artifact = await service.create(makeInput());
    expect(artifact.id).toMatch(/^plugin:1700000000000:[0-9a-z]+$/);
    expect(artifact.version).toBe(1);
    expect(artifact.history).toHaveLength(1);
    expect(artifact.history[0]).toEqual({
      version: 1,
      code: 'export function rank(x) { return x; }',
      at: now,
      trigger: 'create',
      outcome: 'accepted',
    });
    expect(artifact.createdAt).toBe(now);
    expect(artifact.updatedAt).toBe(now);
  });

  it('人工闸门：创建后默认 enabled=false，必须由人显式开启', async () => {
    const artifact = await service.create(makeInput());
    expect(artifact.enabled).toBe(false);
    expect((await service.get(artifact.id))?.enabled).toBe(false);

    await service.setEnabled(artifact.id, true);
    expect((await service.get(artifact.id))?.enabled).toBe(true);
    await service.setEnabled(artifact.id, false);
    expect((await service.get(artifact.id))?.enabled).toBe(false);
  });

  it('两个 create 的 id 不冲突', async () => {
    const a = await service.create(makeInput());
    const b = await service.create(makeInput());
    expect(a.id).not.toBe(b.id);
    expect(await service.list()).toHaveLength(2);
  });

  it('可选字段按值写入；未提供的可选字段不写成 undefined', async () => {
    const artifact = await service.create(
      makeInput({ scope: { eventId: 12 }, conversationRef: 'conv-42' }),
    );
    expect(artifact.scope).toEqual({ eventId: 12 });
    expect(artifact.conversationRef).toBe('conv-42');

    const plain = await service.create(makeInput());
    expect(plain.scope).toBeUndefined();
    expect(plain.conversationRef).toBeUndefined();
    expect(Object.keys(plain)).not.toContain('scope');
    expect(Object.keys(plain)).not.toContain('conversationRef');
  });

  it('spec 被深拷贝，外部修改入参不影响已存工件', async () => {
    const input = makeInput();
    const artifact = await service.create(input);
    input.spec.hostApi.push('evil');
    input.spec.limits.timeoutMs = 999;
    expect((await service.get(artifact.id))?.spec.hostApi).toEqual(['log']);
    expect((await service.get(artifact.id))?.spec.limits.timeoutMs).toBe(2000);
  });
});

describe('revise', () => {
  it('全量替换 code，version+1，history 追加一条（旧 code 留在旧记录里）', async () => {
    const artifact = await service.create(makeInput());
    now += 5000;

    const revised = await service.revise(artifact.id, {
      code: 'export function rank(x) { return x.slice().reverse(); }',
      trigger: 'auto-repair',
      feedback: '输出不符合契约',
      outcome: 'rejected',
    });

    expect(revised.code).toBe('export function rank(x) { return x.slice().reverse(); }');
    expect(revised.version).toBe(2);
    expect(revised.updatedAt).toBe(now);
    expect(revised.history).toHaveLength(2);
    expect(revised.history[0]?.code).toBe('export function rank(x) { return x; }');
    expect(revised.history[1]?.version).toBe(2);
    expect(revised.history[1]?.code).toBe('export function rank(x) { return x.slice().reverse(); }');
    expect(revised.history[1]?.trigger).toBe('auto-repair');
    expect(revised.history[1]?.feedback).toBe('输出不符合契约');
    expect(revised.history[1]?.outcome).toBe('rejected');
    expect(revised.history[1]?.at).toBe(now);
  });

  it('多轮修订 version 与 history 持续递增；outcome 省略时默认 accepted', async () => {
    const artifact = await service.create(
      makeInput({ scope: { eventId: 3 }, conversationRef: '原会话' }),
    );
    let current: PluginArtifact = artifact;
    for (let i = 2; i <= 4; i += 1) {
      now += 1000;
      current = await service.revise(artifact.id, {
        code: `code-v${i}`,
        trigger: 'user-feedback',
      });
      expect(current.version).toBe(i);
      expect(current.history).toHaveLength(i);
      expect(current.history[i - 1]?.outcome).toBe('accepted');
    }

    // 写操作保持工件自足：intent / spec / history / scope / conversationRef 都不丢
    expect(current.intent).toBe(artifact.intent);
    expect(current.spec).toEqual(artifact.spec);
    expect(current.scope).toEqual({ eventId: 3 });
    expect(current.conversationRef).toBe('原会话');
    expect(current.origin).toBe('llm');
    expect(current.enabled).toBe(false);
    expect(current.createdAt).toBe(artifact.createdAt);
    expect(current.history[0]?.trigger).toBe('create');
  });

  it('不存在的 id 抛错', async () => {
    await expect(
      service.revise('plugin:missing', { code: 'x', trigger: 'manual' }),
    ).rejects.toThrow(/not found/);
    await expect(service.setEnabled('plugin:missing', true)).rejects.toThrow(/not found/);
  });
});

describe('get / list / remove', () => {
  it('get 命中与未命中；list 返回全部；remove 后不可读', async () => {
    const artifact = await service.create(makeInput());
    expect(await service.get(artifact.id)).not.toBeNull();
    expect(await service.get('nope')).toBeNull();
    expect(await service.list()).toHaveLength(1);

    await service.remove(artifact.id);
    expect(await service.get(artifact.id)).toBeNull();
    expect(await service.list()).toEqual([]);
  });
});

describe('会话清空后工件仍可读可改', () => {
  it('只保留持久化 Map，新建 store + service 后仍可 get / revise / setEnabled', async () => {
    const artifact = await service.create(
      makeInput({ scope: { eventId: 88 }, conversationRef: '会话A（随后被清空）' }),
    );
    now += 10;
    await service.setEnabled(artifact.id, true);

    // 会话状态整体丢弃；工件只活在持久化介质里
    const revivedStore = new InMemoryPluginArtifactStore(persistence);
    const revivedService = new PluginArtifactService(revivedStore, () => now);

    const restored = await revivedService.get(artifact.id);
    expect(restored).not.toBeNull();
    expect(restored?.intent).toBe(artifact.intent);
    expect(restored?.spec).toEqual(artifact.spec);
    expect(restored?.code).toBe(artifact.code);
    expect(restored?.conversationRef).toBe('会话A（随后被清空）');

    now += 20;
    const revised = await revivedService.revise(artifact.id, {
      code: 'export function rank(x) { return x; } // 新会话里修订',
      trigger: 'manual',
    });
    expect(revised.version).toBe(2);
    expect(revised.history).toHaveLength(2);
    expect(revised.intent).toBe(artifact.intent);
    expect(revised.spec).toEqual(artifact.spec);
    expect(revised.enabled).toBe(true);

    await revivedService.setEnabled(artifact.id, false);
    const final = await revivedService.get(artifact.id);
    expect(final?.enabled).toBe(false);
    expect(final?.code).toContain('新会话里修订');
    expect(final?.scope).toEqual({ eventId: 88 });
  });
});
