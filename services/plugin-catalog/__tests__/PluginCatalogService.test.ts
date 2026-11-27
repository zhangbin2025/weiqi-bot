/**
 * PluginCatalogService 编排测试
 *
 * 覆盖用户拍板的三条核心决策：
 * 1. 只装 plugin，tool 只展示；
 * 2. 同一个插件（catalogRef 相同）远端 code 与本地不同 → state=update；
 * 3. 更新走 revise 保留 history、不新建副本；新建默认停用且写 catalogRef。
 *
 * 全部用内存工件存储 + 注入 fetch，不打真实网络 / 不加载 wasm。
 */

import { describe, it, expect } from 'vitest';
import { PluginCatalogService } from '../PluginCatalogService';
import { PluginCatalogClient } from '../PluginCatalogClient';
import { PluginCatalogCache } from '../PluginCatalogCache';
import { PluginCatalogSources, DEFAULT_REGISTRY_URL } from '../PluginCatalogSources';
import { PluginArtifactService } from '@application/plugin/PluginArtifactService';
import { InMemoryPluginArtifactStore } from '@infrastructure/plugin/InMemoryPluginArtifactStore';
import { RANKING_SPEC } from '@domain/plugin/types';
import type { LocalStorageAdapter } from '@infrastructure/storage/adapters/web/LocalStorageAdapter';

const BASE = 'https://weiqi-dev.github.io/weiqi-assets/';
const REGISTRY_URL = `${BASE}registry.json`;
const PLUGIN_PATH = 'plugins/ranking/total-score/plugin.json';
const CODE_PATH = 'plugins/ranking/total-score/index.js';

/** 能通过 PluginValidator 静态预检、且声明了 rank 入口的最小源码 */
const CODE_V1 = 'function rank(input) { return { columns: [], rows: [] }; }';
const CODE_V2 = 'function rank(input) { return { columns: [], rows: [] }; } // v2';

function registry(pluginCode: string) {
  return {
    schemaVersion: 1,
    name: 'weiqi-assets',
    description: 'test',
    baseUrl: BASE,
    resources: [
      {
        id: 'ranking.total-score', type: 'plugin', name: '总分排序', summary: '按总分排名',
        pointId: 'ranking', specVersion: 1, path: PLUGIN_PATH,
      },
      {
        id: 'web-fetch.v1', type: 'tool', name: 'web_fetch', summary: '声明镜像',
        path: 'tools/web-fetch/v1/tool.json',
      },
    ],
    _pluginCode: pluginCode,
  };
}

function manifest(codeRel: string) {
  return {
    id: 'ranking.total-score', name: '总分排序', type: 'plugin',
    pointId: 'ranking', specVersion: 1, entry: 'rank', code: codeRel,
    origin: 'manual', intent: '按总分排名',
  };
}

function makeFetch(code: string): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith('registry.json')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(registry(code)) } as Response;
    }
    if (u.endsWith(PLUGIN_PATH)) {
      return { ok: true, status: 200, text: async () => JSON.stringify(manifest(CODE_PATH)) } as Response;
    }
    if (u.endsWith(CODE_PATH)) {
      return { ok: true, status: 200, text: async () => code } as Response;
    }
    return { ok: false, status: 404, text: async () => '' } as Response;
  }) as unknown as typeof fetch;
}

/** 用内存 Map 模拟 LocalStorageAdapter，避免 jsdom 依赖 */
function fakeLocalStorage(): LocalStorageAdapter {
  const data = new Map<string, string>();
  return {
    initialize: async () => {},
    read: async <T>(key: string): Promise<T | null> => {
      const raw = data.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    write: async <T>(key: string, value: T): Promise<void> => {
      data.set(key, JSON.stringify(value));
    },
    delete: async (key: string): Promise<void> => { data.delete(key); },
  } as unknown as LocalStorageAdapter;
}

function setup(code: string) {
  const store = new InMemoryPluginArtifactStore();
  const artifacts = new PluginArtifactService(store);
  const localStorage = fakeLocalStorage();
  const client = new PluginCatalogClient({ fetchImpl: makeFetch(code) });
  const sources = new PluginCatalogSources({ localStorage });
  const cache = new PluginCatalogCache({ localStorage });
  const service = new PluginCatalogService({ client, sources, cache, artifacts });
  return { service, artifacts, sources, cache, localStorage };
}

async function pluginEntry(service: PluginCatalogService) {
  const result = await service.browse();
  return result.entries.find((e) => e.kind === 'plugin');
}

describe('PluginCatalogService.browse', () => {
  it('默认源恒在首位且只读；tool 条目只展示不安装', async () => {
    const { service, sources } = setup(CODE_V1);
    const list = await sources.list();
    expect(list).toEqual([{ url: DEFAULT_REGISTRY_URL, official: true }]);
    expect((await sources.current()).official).toBe(true);

    const result = await service.browse();
    expect(result.failures).toHaveLength(0);
    const tool = result.entries.find((e) => e.kind === 'tool');
    expect(tool?.state).toBe('tool-only');
    const plugin = result.entries.find((e) => e.kind === 'plugin');
    expect(plugin?.state).toBe('new');
    expect(plugin?.remoteCode).toBe(CODE_V1);
  });

  it('不兼容的 pointId / specVersion 被标 incompatible', async () => {
    const { service } = setup(CODE_V1);
    const badFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('registry.json')) {
        const r = registry(CODE_V1);
        (r.resources[0] as Record<string, unknown>)['pointId'] = 'ranking.tiebreak';
        return { ok: true, status: 200, text: async () => JSON.stringify(r) } as Response;
      }
      return makeFetch(CODE_V1)(url);
    }) as unknown as typeof fetch;
    // manifest 也改成同值，避免被 fetchManifest 的一致性检查先拦下
    const badClient = new PluginCatalogClient({
      fetchImpl: (async (url: string | URL | Request) => {
        const u = String(url);
        if (u.endsWith(PLUGIN_PATH)) {
          const m = manifest(CODE_PATH);
          (m as Record<string, unknown>)['pointId'] = 'ranking.tiebreak';
          return { ok: true, status: 200, text: async () => JSON.stringify(m) } as Response;
        }
        return badFetch(url);
      }) as unknown as typeof fetch,
    });
    const store = new InMemoryPluginArtifactStore();
    const ls = fakeLocalStorage();
    const custom = new PluginCatalogService({
      client: badClient,
      sources: new PluginCatalogSources({ localStorage: ls }),
      cache: new PluginCatalogCache({ localStorage: ls }),
      artifacts: new PluginArtifactService(store),
    });
    const result = await custom.browse();
    expect(result.entries.find((e) => e.kind === 'plugin')?.state).toBe('incompatible');
  });
});

describe('PluginCatalogService.install', () => {
  it('新建：默认停用 + catalogRef 记录来源 + spec 用宿主 RANKING_SPEC', async () => {
    const { service, artifacts } = setup(CODE_V1);
    const entry = await pluginEntry(service);
    expect(entry).toBeDefined();

    const result = await service.install(entry!);
    expect(result.action).toBe('installed');
    expect(result.artifact?.enabled).toBe(false);
    expect(result.artifact?.catalogRef).toEqual({
      registryUrl: DEFAULT_REGISTRY_URL,
      resourceId: 'ranking.total-score',
    });
    expect(result.artifact?.spec).toEqual(RANKING_SPEC);
    expect((await artifacts.list())).toHaveLength(1);
  });

  it('同一个插件远端源码变化 → state=update，安装变更新且保留 history', async () => {
    const store = new InMemoryPluginArtifactStore();
    const artifacts = new PluginArtifactService(store);
    const localStorage = fakeLocalStorage();
    const sources = new PluginCatalogSources({ localStorage });
    const cache = new PluginCatalogCache({ localStorage });

    const v1 = new PluginCatalogService({
      client: new PluginCatalogClient({ fetchImpl: makeFetch(CODE_V1) }),
      sources, cache, artifacts,
    });
    const first = await v1.install((await pluginEntry(v1))!);
    expect(first.action).toBe('installed');
    const id = first.artifact!.id;
    expect(first.artifact!.history).toHaveLength(1);

    // 同一份本地工件，远端换成 v2
    const v2 = new PluginCatalogService({
      client: new PluginCatalogClient({ fetchImpl: makeFetch(CODE_V2) }),
      sources, cache, artifacts,
    });
    const refreshed = await pluginEntry(v2);
    expect(refreshed?.state).toBe('update');
    expect(refreshed?.localArtifactId).toBe(id);

    const updated = await v2.install(refreshed!);
    expect(updated.action).toBe('updated');
    expect(updated.artifact?.id).toBe(id);              // 不新建副本
    expect(updated.artifact?.code).toBe(CODE_V2);
    expect(updated.artifact?.version).toBe(2);
    expect(updated.artifact?.history).toHaveLength(2);  // 保留历史
    expect((await artifacts.list())).toHaveLength(1);
  });

  it('沙箱环境失败（crash/timeout）只给 warning，工件仍默认停用可安装', async () => {
    const { service, artifacts } = setup(CODE_V1);
    const entry = (await pluginEntry(service))!;
    const fakeRuntime = {
      run: async () => ({
        ok: false as const,
        phase: 'crash' as const,
        error: { name: 'WorkerCrashError', message: 'wasm 加载失败' },
        logs: [],
        elapsedMs: 1,
      }),
      dispose: async () => {},
    };
    const withRuntime = new PluginCatalogService({
      client: new PluginCatalogClient({ fetchImpl: makeFetch(CODE_V1) }),
      sources: new PluginCatalogSources({ localStorage: fakeLocalStorage() }),
      cache: new PluginCatalogCache({ localStorage: fakeLocalStorage() }),
      artifacts,
      runtime: fakeRuntime,
    });
    const out = await withRuntime.install(entry);
    expect(out.ok).toBe(true);
    expect(out.action).toBe('installed');
    expect(out.warning).toContain('沙箱环境不可用');
    expect(out.artifact?.enabled).toBe(false);
  });

  it('源码编译失败（compile）硬拒绝', async () => {
    const { service, artifacts } = setup(CODE_V1);
    const entry = (await pluginEntry(service))!;
    const fakeRuntime = {
      run: async () => ({
        ok: false as const,
        phase: 'compile' as const,
        error: { name: 'SyntaxError', message: 'unexpected token' },
        logs: [],
        elapsedMs: 1,
      }),
      dispose: async () => {},
    };
    const withRuntime = new PluginCatalogService({
      client: new PluginCatalogClient({ fetchImpl: makeFetch(CODE_V1) }),
      sources: new PluginCatalogSources({ localStorage: fakeLocalStorage() }),
      cache: new PluginCatalogCache({ localStorage: fakeLocalStorage() }),
      artifacts,
      runtime: fakeRuntime,
    });
    const out = await withRuntime.install(entry);
    expect(out.ok).toBe(false);
    expect(out.action).toBe('rejected');
    expect(await artifacts.list()).toHaveLength(0);
  });

  it('源码相同 → 无需变更', async () => {
    const { service, artifacts } = setup(CODE_V1);
    await service.install((await pluginEntry(service))!);
    const again = await service.install((await pluginEntry(service))!);
    expect(again.action).toBe('unchanged');
    expect((await artifacts.list())).toHaveLength(1);
  });

  it('tool 条目拒绝安装', async () => {
    const { service } = setup(CODE_V1);
    const result = await service.browse();
    const tool = result.entries.find((e) => e.kind === 'tool')!;
    const out = await service.install(tool);
    expect(out.ok).toBe(false);
    expect(out.action).toBe('rejected');
  });
});

describe('PluginCatalogSources 单源模型', () => {
  it('当前源默认官方；可替换为自定义源，可恢复默认', async () => {
    const { sources } = setup(CODE_V1);
    expect(await sources.current()).toEqual({ url: DEFAULT_REGISTRY_URL, official: true });

    await sources.setCurrent('https://mirror.example.com/registry.json');
    expect(await sources.current()).toEqual({
      url: 'https://mirror.example.com/registry.json', official: false,
    });
    expect(await sources.list()).toHaveLength(1); // 单源，不做多源合并

    await sources.reset();
    expect(await sources.current()).toEqual({ url: DEFAULT_REGISTRY_URL, official: true });
  });

  it('http 与私网地址被拒，且不改变当前源', async () => {
    const { sources } = setup(CODE_V1);
    await expect(sources.setCurrent('http://example.com/registry.json')).rejects.toThrow('https');
    await expect(sources.setCurrent('http://127.0.0.1/registry.json')).rejects.toThrow();
    expect((await sources.current()).official).toBe(true);
  });
});


// ---------- 分类标签（2026-11-21）：registry → CatalogEntry → 工件，更新时同步 ----------
describe('分类标签 category 落地', () => {
  it('registry 声明的 category 出现在 browse 条目里，安装写进工件', async () => {
    const raw = registry(CODE_V1);
    (raw.resources[0] as Record<string, unknown>)['category'] = '排名';
    const client = new PluginCatalogClient({
      fetchImpl: (async (url: string | URL | Request) => {
        if (String(url).endsWith('registry.json')) {
          return { ok: true, status: 200, text: async () => JSON.stringify(raw) } as Response;
        }
        return makeFetch(CODE_V1)(url);
      }) as unknown as typeof fetch,
    });
    const ls = fakeLocalStorage();
    const store = new InMemoryPluginArtifactStore();
    const artifacts = new PluginArtifactService(store);
    const service = new PluginCatalogService({
      client,
      sources: new PluginCatalogSources({ localStorage: ls }),
      cache: new PluginCatalogCache({ localStorage: ls }),
      artifacts,
    });
    const entry = await pluginEntry(service);
    expect(entry?.category).toBe('排名');
    const out = await service.install(entry!);
    expect(out.artifact?.category).toBe('排名');
    expect((await artifacts.list())[0]!.category).toBe('排名');
  });

  it('只改清单标注（源码不变）→ 更新同步分类；撤掉标注 → 清掉旧值', async () => {
    const ls = fakeLocalStorage();
    const store = new InMemoryPluginArtifactStore();
    const artifacts = new PluginArtifactService(store);
    let category: string | undefined = '排名';
    const client = new PluginCatalogClient({
      fetchImpl: (async (url: string | URL | Request) => {
        if (String(url).endsWith('registry.json')) {
          const raw = registry(CODE_V1);
          if (category !== undefined) (raw.resources[0] as Record<string, unknown>)['category'] = category;
          return { ok: true, status: 200, text: async () => JSON.stringify(raw) } as Response;
        }
        return makeFetch(CODE_V1)(url);
      }) as unknown as typeof fetch,
    });
    const service = new PluginCatalogService({
      client,
      sources: new PluginCatalogSources({ localStorage: ls }),
      cache: new PluginCatalogCache({ localStorage: ls }),
      artifacts,
    });
    const first = await service.install((await pluginEntry(service))!);
    expect(first.artifact?.category).toBe('排名');

    category = '算子';
    const second = await service.install((await pluginEntry(service))!);
    expect(second.action).toBe('unchanged');
    expect((await artifacts.list())[0]!.category).toBe('算子');

    category = undefined;
    await service.install((await pluginEntry(service))!);
    expect((await artifacts.list())[0]!.category).toBeUndefined();
  });
  it('browseResources 只读取请求的资源，不下载目录中其它插件的 manifest / 源码', async () => {
    const raw = registry(CODE_V1);
    raw.resources.push({
      id: 'unused.plugin', type: 'plugin', name: '无关插件', summary: '不应读取',
      pointId: 'ranking', specVersion: 1, path: 'plugins/unused/plugin.json',
    });
    const calls: string[] = [];
    const fallback = makeFetch(CODE_V1);
    const client = new PluginCatalogClient({
      fetchImpl: (async (url: string | URL | Request) => {
        const value = String(url);
        calls.push(value);
        if (value.endsWith('registry.json')) {
          return { ok: true, status: 200, text: async () => JSON.stringify(raw) } as Response;
        }
        return fallback(url);
      }) as unknown as typeof fetch,
    });
    const localStorage = fakeLocalStorage();
    const artifacts = new PluginArtifactService(new InMemoryPluginArtifactStore());
    const service = new PluginCatalogService({
      client,
      sources: new PluginCatalogSources({ localStorage }),
      cache: new PluginCatalogCache({ localStorage }),
      artifacts,
    });

    const result = await service.browseResources(['ranking.total-score']);
    expect(result.entries.map((entry) => entry.resourceId)).toEqual(['ranking.total-score']);
    expect(calls.some((url) => url.includes('plugins/unused/plugin.json'))).toBe(false);
    expect(calls.some((url) => url.includes('plugins/unused/index.js'))).toBe(false);
  });

});
