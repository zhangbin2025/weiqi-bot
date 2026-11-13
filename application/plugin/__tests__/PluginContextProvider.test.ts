/**
 * 插件上下文提供者测试
 * 验证精简清单不含 code、字段截断、排序规则，以及按需展开源码。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { PluginArtifact, PluginSpec } from '../../../domain/plugin/types';
import {
  InMemoryPluginArtifactStore,
  type PluginArtifactPersistence,
} from '../../../infrastructure/plugin/InMemoryPluginArtifactStore';
import {
  PluginContextProvider,
  truncateForPrompt,
} from '../PluginContextProvider';

function makeSpec(): PluginSpec {
  return {
    pointId: 'ranking',
    version: 1,
    entry: 'rank',
    hostApi: [],
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

function makeArtifact(overrides: Partial<PluginArtifact> = {}): PluginArtifact {
  return {
    id: 'plugin:1:a',
    name: '排序',
    pointId: 'ranking',
    version: 1,
    enabled: false,
    origin: 'llm',
    intent: '同分排序',
    code: 'SECRET_CODE_SHOULD_NOT_LEAK_INTO_SNAPSHOT',
    spec: makeSpec(),
    createdAt: 1000,
    updatedAt: 1000,
    history: [
      { version: 1, code: 'v1', at: 1000, trigger: 'create', outcome: 'accepted' },
    ],
    ...overrides,
  };
}

let persistence: PluginArtifactPersistence;
let store: InMemoryPluginArtifactStore;
let provider: PluginContextProvider;

beforeEach(() => {
  persistence = new Map<string, string>();
  store = new InMemoryPluginArtifactStore(persistence);
  provider = new PluginContextProvider(store);
});

describe('truncateForPrompt', () => {
  it('未超长时原样返回；超长按码点截断并加省略号', () => {
    expect(truncateForPrompt('abc', 10)).toBe('abc');
    expect(truncateForPrompt('abcdef', 6)).toBe('abcdef');
    const cut = truncateForPrompt('abcdefghij', 5);
    expect([...cut]).toHaveLength(5);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).toBe('abcd…');
    expect(truncateForPrompt('中文字符', 3)).toBe('中文…');
    expect(truncateForPrompt('anything', 0)).toBe('');
  });
});

describe('snapshot', () => {
  it('每个条目都不含 code 属性（连空值都不写），也不泄漏源码文本', async () => {
    await store.create(makeArtifact());
    const [entry] = await provider.snapshot();
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {})).not.toContain('code');
    expect(JSON.stringify(await provider.snapshot())).not.toContain('SECRET_CODE');
    expect(entry?.id).toBe('plugin:1:a');
    expect(entry?.name).toBe('排序');
    expect(entry?.pointId).toBe('ranking');
    expect(entry?.enabled).toBe(false);
    expect(entry?.version).toBe(1);
    expect(entry?.intent).toBe('同分排序');
  });

  it('enabled 优先，其次 updatedAt 降序', async () => {
    await store.create(makeArtifact({ id: 'a', name: '旧禁用', enabled: false, updatedAt: 9000 }));
    await store.create(makeArtifact({ id: 'b', name: '新禁用', enabled: false, updatedAt: 8000 }));
    await store.create(makeArtifact({ id: 'c', name: '旧启用', enabled: true, updatedAt: 1000 }));
    await store.create(makeArtifact({ id: 'd', name: '新启用', enabled: true, updatedAt: 5000 }));

    const entries = await provider.snapshot();
    expect(entries.map((e) => e.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('name / intent 按配置截断，防止撑爆 system prompt', async () => {
    const long = '很长'.repeat(200);
    const scoped = new PluginContextProvider(store, {
      maxNameLength: 10,
      maxIntentLength: 20,
    });
    await store.create(makeArtifact({ name: long, intent: long, code: 'v1' }));

    const [entry] = await scoped.snapshot();
    expect([...(entry?.name ?? '')]).toHaveLength(10);
    expect([...(entry?.intent ?? '')]).toHaveLength(20);
    expect(entry?.name.endsWith('…')).toBe(true);
    expect(entry?.intent.endsWith('…')).toBe(true);
  });

  it('空存储返回空数组', async () => {
    expect(await provider.snapshot()).toEqual([]);
  });
});

describe('withCode', () => {
  it('返回带完整 code 的条目，其余字段与 snapshot 一致（含截断）', async () => {
    await store.create(makeArtifact({ intent: '同分排序'.repeat(100) }));
    const withCode = await provider.withCode('plugin:1:a');
    expect(withCode).not.toBeNull();
    expect(withCode?.code).toBe('SECRET_CODE_SHOULD_NOT_LEAK_INTO_SNAPSHOT');
    expect([...(withCode?.intent ?? '')]).toHaveLength(200);
    expect(withCode?.version).toBe(1);
    expect(withCode?.enabled).toBe(false);
  });

  it('不存在的 id 返回 null', async () => {
    expect(await provider.withCode('missing')).toBeNull();
  });

  it('会话清空后（只剩持久化 Map）仍能取出 code 和精简清单', async () => {
    await store.create(makeArtifact({ conversationRef: '已清空的会话' }));
    const revived = new PluginContextProvider(
      new InMemoryPluginArtifactStore(persistence),
    );

    const entries = await revived.snapshot();
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain('SECRET_CODE');
    expect((await revived.withCode('plugin:1:a'))?.code).toBe(
      'SECRET_CODE_SHOULD_NOT_LEAK_INTO_SNAPSHOT',
    );
  });
});
