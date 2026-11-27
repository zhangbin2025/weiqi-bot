/**
 * 发布原语回归：fetch 的 this 必须是 Window/globalThis。
 *
 * 浏览器（尤其 Android WebView）里 window.fetch 是原生方法，把它当普通对象的方法
 * 调用会抛 "Failed to execute 'fetch' on 'Window': Illegal invocation"。
 * 本用例不触网：fetchImpl 桩 + 内存 kv / 技能库。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createPublishPrimitives, createSecretSpecRegistry, collectWorkflowDependencyNamespaces,
  ASSET_EXPORT_TOOL_NAME, GITHUB_PUBLISH_FILE_TOOL_NAME,
} from '../AuthFetchPrimitives';
import type { SecretSpec } from '@application/skill/SecretSpec';
import type { UserSkillEntry } from '@application/skill/dev/UserSkillStore';

const GH: SecretSpec = {
  key: 'github_token',
  label: 'GitHub Personal Access Token',
  setupUrl: 'https://github.com/settings/tokens',
  allowedHosts: ['api.github.com'],
  header: { name: 'Authorization', prefix: 'Bearer ' },
  method: 'GET',
};

/** 本地技能库桩：一条不带 workflow 的散文配方，避免牵扯算子插件。 */
const SKILL = {
  schemaVersion: 1,
  id: 'user.publish-smoke',
  name: '发布冒烟',
  summary: '冒烟',
  version: 1,
  primitives: [ASSET_EXPORT_TOOL_NAME, GITHUB_PUBLISH_FILE_TOOL_NAME],
  prompt: '略',
} as unknown as UserSkillEntry['recipe'];

/** GET 索引时 githubGet 会解 JSON 清单，content 必须是合法 JSON 的 base64。 */
const INDEX_BODY_B64 = btoa(JSON.stringify({ schemaVersion: 2, skills: [], resources: [] }));

function jsonResponse(status: number, body: unknown): Response {
  return {
    status, statusText: status === 200 ? 'OK' : 'ERR', ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

/** 模拟原生 fetch：this 必须是 Window/globalThis，否则抛 Illegal invocation。 */
function strictFetch(this: unknown, ..._args: unknown[]): Promise<Response> {
  const win = (globalThis as { window?: unknown }).window ?? globalThis;
  if (this !== win) {
    throw new TypeError('Failed to execute fetch on Window: Illegal invocation');
  }
  return Promise.resolve(jsonResponse(200, { content: INDEX_BODY_B64, sha: 'cafebabe' }));
}

type StrictImpl = (this: unknown, url: string, init?: RequestInit) => Promise<Response>;

function setup(impl?: StrictImpl) {
  const kv = { readRaw: vi.fn(async (_d: string, _k: string) => 'ghp_SMOKE_TOKEN') };
  const specs = createSecretSpecRegistry([GH]);
  const users = {
    list: async () => [{
      recipe: SKILL, enabled: true, source: 'custom', updatedAt: 0,
    }] as UserSkillEntry[],
  };
  const calls: [string, RequestInit][] = [];
  let fetchImpl: typeof globalThis.fetch | undefined;
  if (impl !== undefined) {
    // 普通 function 而非箭头：把 ghFetch 传进来的 this 原样转发给被测桩，
    // 这样「以 ctx 为 this」的旧写法会真的触发 Illegal invocation。
    fetchImpl = function (this: unknown, url: string, init?: RequestInit): Promise<Response> {
      calls.push([url, init ?? {}]);
      return impl.call(this, url, init);
    } as unknown as typeof globalThis.fetch;
  }
  const prims = createPublishPrimitives({
    // 与既有 primitives 单测同口径：桩只实现被用到的最小方法，类型用 never 收口。
    kv: kv as never, specs, userSkills: users as never, timeoutMs: 1000,
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  });
  const exp = prims.find((p) => p.name === ASSET_EXPORT_TOOL_NAME)!;
  const pub = prims.find((p) => p.name === GITHUB_PUBLISH_FILE_TOOL_NAME)!;
  return { exp, pub, kv, calls };
}

async function exportHandle(exp: ReturnType<typeof setup>['exp']): Promise<string> {
  const e = await exp.execute({ kind: 'skill', id: SKILL.id });
  expect(e.ok).toBe(true);
  const handle = (e.observation.match(/asset:skill:[^\s\n]+/) ?? [])[0];
  expect(handle).toBeTruthy();
  return handle!;
}

function assertCalls(calls: [string, RequestInit][]): void {
  // skill.json / README.md / skills/registry.json 三个文件，各一次 GET + 一次 PUT
  expect(calls.length).toBe(6);
  for (const [url, init] of calls) {
    expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\/weiqi-dev\/weiqi-assets\/contents\//);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer ghp_SMOKE_TOKEN');
    expect(init.credentials).toBe('omit');
  }
}


describe('Workflow 发布依赖命名空间收集', () => {
  it('跳过宿主 json / regex，同时递归保留领域插件依赖', () => {
    const steps = [
      { call: 'json.get' },
      { call: 'regex.extract' },
      { call: 'baidu.hotsearch' },
      { forEach: { steps: [{ call: 'circle.foxwq' }, { call: 'json.select' }] } },
      { ifElse: { then: [{ call: 'stock.news.10jqka' }], else: [{ call: 'regex.match' }] } },
    ] as unknown as import('@application/skill/SkillTypes').WorkflowStep[];
    expect(collectWorkflowDependencyNamespaces(steps)).toEqual([
      'baidu', 'circle', 'stock',
    ]);
  });

  it('没有插件算子时返回空依赖', () => {
    expect(collectWorkflowDependencyNamespaces([
      { call: 'json.parse' }, { call: 'regex.replace' },
    ] as unknown as import('@application/skill/SkillTypes').WorkflowStep[])).toEqual([]);
  });
});

describe('github_publish_file（fetch 的 this 绑定）', () => {
  it('注入未绑定的原生式 fetch 也能完成 GET/PUT，不抛 Illegal invocation', async () => {
    const { exp, pub, calls } = setup(strictFetch as StrictImpl);
    const handle = await exportHandle(exp);

    const r = await pub.execute({ handle });
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('HTTP 200');
    expect(r.observation).not.toContain('Illegal invocation');
    expect(r.observation).not.toContain('发布中断');
    assertCalls(calls);
  });

  it('不注入 fetchImpl、走工厂默认实现时 this 仍然合法', async () => {
    const original = globalThis.fetch;
    (globalThis as { fetch?: unknown }).fetch = strictFetch;
    try {
      const { exp, pub } = setup();
      const handle = await exportHandle(exp);
      const r = await pub.execute({ handle });
      expect(r.ok).toBe(true);
      expect(r.observation).not.toContain('Illegal invocation');
      expect(r.observation).not.toContain('发布中断');
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });

  it('对照：严格 fetch 以普通对象为 this 时确实同步抛非法调用（证明用例测到了 this）', () => {
    // 原生 fetch 的 Illegal invocation 是同步抛出，不是 rejected Promise；
    // 因此这里用同步 expect(() => …)，也顺带固定这条语义供回归比对。
    expect(() => (strictFetch as (...a: unknown[]) => Promise<Response>).call({}))
      .toThrow('Illegal invocation');
  });
});
