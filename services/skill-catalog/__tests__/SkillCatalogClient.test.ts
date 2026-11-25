/**
 * SkillCatalogClient 契约测试（两段式取数：瘦索引 + 逐条 skill.json）
 *
 * 重点：URL 拼接（复用插件侧 resolveBaseUrl / resolveSameOrigin）、越界条目跳过、
 *       索引↔配方重叠字段一致性、noStore 对两段每个请求都生效、中文错误口径。
 * fetch 全部注入，不打真实网络。
 */

import { describe, it, expect } from 'vitest';
import { SkillCatalogClient, type ParsedSkillEntry } from '../SkillCatalogClient';

const REGISTRY_URL = 'https://assets.example.com/skills/registry.json';
const SKILLS_BASE = 'https://assets.example.com/skills/';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as Response;
}

function recipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'weather.wttr',
    version: 4,
    name: '查天气',
    summary: '查当前天气',
    primitives: ['web_fetch'],
    prompt: '调用 web_fetch 取天气。',
    ...overrides,
  };
}

/** v2 瘦索引：baseUrl 可显式给，也可省略让目录兜底 */
function index(
  entries: Record<string, unknown>[],
  baseUrl?: string,
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name: 'weiqi-bot skills',
    description: 'test',
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    skills: entries,
  };
}

function indexEntry(r: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  // 与 SkillCatalogService.test.ts 的 indexOf 同口径：索引条目要把所有
  // fetchSkill 会比对的重叠字段原样抄过来（routeHint / category 缺省则不出现）。
  const entry: Record<string, unknown> = {
    id: r['id'],
    version: r['version'],
    name: r['name'],
    summary: r['summary'],
    primitives: r['primitives'],
    path: `${String(r['id'])}/skill.json`,
  };
  if (r['routeHint'] !== undefined) entry['routeHint'] = r['routeHint'];
  if (r['category'] !== undefined) entry['category'] = r['category'];
  return { ...entry, ...overrides };
}

/** 按 URL 路由：registry.json → 索引；<id>/skill.json → 配方；其余 404 */
function fetchSource(
  indexBody: Record<string, unknown>,
  recipes: Record<string, unknown>[],
  calls?: Array<{ url: string; init?: RequestInit }>,
): typeof fetch {
  const byId = new Map(recipes.map((r) => [String(r['id']), r]));
  return (async (url: string, init?: RequestInit) => {
    if (calls) calls.push({ url, ...(init !== undefined ? { init } : {}) });
    if (url === REGISTRY_URL) return jsonResponse(indexBody);
    const match = /\/([^/]+)\/skill\.json$/.exec(url);
    if (match) {
      const body = byId.get(match[1]!);
      if (body !== undefined) return jsonResponse(body);
    }
    return jsonResponse({}, false, 404);
  }) as unknown as typeof fetch;
}

describe('SkillCatalogClient.fetchRegistry — v2 索引与 skillUrl 拼接', () => {
  it('显式 baseUrl：拼出指向 skills/ 目录的 skillUrl', async () => {
    const r = recipe();
    const client = new SkillCatalogClient({
      fetchImpl: fetchSource(index([indexEntry(r)], SKILLS_BASE), [r]),
    });
    const parsed = await client.fetchRegistry(REGISTRY_URL);
    expect(parsed.registryUrl).toBe(REGISTRY_URL);
    expect(parsed.baseUrl).toBe(SKILLS_BASE);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.skillUrl).toBe(`${SKILLS_BASE}weather.wttr/skill.json`);
    expect(parsed.entries[0]?.entry.id).toBe('weather.wttr');
  });

  it('baseUrl 缺省：用清单 URL 所在目录兜底，拼出的 URL 与显式情形一致', async () => {
    const r = recipe();
    const client = new SkillCatalogClient({
      fetchImpl: fetchSource(index([indexEntry(r)]), [r]),
    });
    const parsed = await client.fetchRegistry(REGISTRY_URL);
    expect(parsed.baseUrl).toBe(SKILLS_BASE);
    expect(parsed.entries[0]?.skillUrl).toBe(`${SKILLS_BASE}weather.wttr/skill.json`);
  });

  it('resolveSameOrigin 拦 ../ / 绝对路径 / 站外 URL → 该条被跳过，其余不受影响', async () => {
    const r = recipe();
    const bad = [
      { path: '../secret.json' },
      { path: '/etc/passwd' },
      { path: 'https://evil.example.com/x.json' },
    ];
    const entries = [
      ...bad.map((b, i) => indexEntry(recipe({ id: `bad${i}` }), b)),
      indexEntry(r),
    ];
    const client = new SkillCatalogClient({
      fetchImpl: fetchSource(index(entries, SKILLS_BASE), [r]),
    });
    const parsed = await client.fetchRegistry(REGISTRY_URL);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.entry.id).toBe('weather.wttr');
  });

  it('索引顶层 schemaVersion 不是 2 / skills 非数组 → 中文错误', async () => {
    for (const body of [
      { schemaVersion: 1, name: 'x', description: 'd', skills: [] },
      { schemaVersion: 3, name: 'x', description: 'd', skills: [] },
      { schemaVersion: 2, name: 'x', description: 'd', skills: 'nope' },
    ]) {
      const client = new SkillCatalogClient({ fetchImpl: (async () => jsonResponse(body)) as unknown as typeof fetch });
      await expect(client.fetchRegistry(REGISTRY_URL)).rejects.toThrow('格式不合法');
    }
  });
});

describe('SkillCatalogClient.fetchSkill — 完整配方与一致性比对', () => {
  const r = recipe();
  const item: ParsedSkillEntry = {
    entry: indexEntry(r) as ParsedSkillEntry['entry'],
    skillUrl: `${SKILLS_BASE}weather.wttr/skill.json`,
    baseUrl: SKILLS_BASE,
  };

  it('成功返回完整 SkillRecipe（含 prompt / 可选字段）', async () => {
    const full = recipe({ routeHint: ['天气'], category: '生活' });
    const client = new SkillCatalogClient({
      fetchImpl: (async () => jsonResponse(full)) as unknown as typeof fetch,
    });
    const skill = await client.fetchSkill({
      ...item, entry: indexEntry(full) as ParsedSkillEntry['entry'],
    });
    expect(skill.id).toBe('weather.wttr');
    expect(skill.prompt).toBe('调用 web_fetch 取天气。');
    expect(skill.routeHint).toEqual(['天气']);
    expect(skill.category).toBe('生活');
  });

  it('索引与配方重叠字段不一致 → 抛中文错误并点名字段', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [recipe({ version: 5 }), 'version'],
      [recipe({ name: '别的名字' }), 'name'],
      [recipe({ summary: '别的摘要' }), 'summary'],
      [recipe({ primitives: ['navigate_to'] }), 'primitives'],
      [recipe({ category: '财经' }), 'category'],
    ];
    for (const [full, field] of cases) {
      const client = new SkillCatalogClient({
        fetchImpl: (async () => jsonResponse(full)) as unknown as typeof fetch,
      });
      await expect(client.fetchSkill(item)).rejects.toThrow(
        `skill.json 与索引条目不一致：字段 ${field}（weather.wttr）`,
      );
    }
  });

  it('结构不合法的 skill.json → 中文「格式不合法」错误', async () => {
    const client = new SkillCatalogClient({
      fetchImpl: (async () => jsonResponse(recipe({ primitives: [] }))) as unknown as typeof fetch,
    });
    await expect(client.fetchSkill(item)).rejects.toThrow('格式不合法');
  });
});

describe('SkillCatalogClient — noStore 与错误口径', () => {
  const r = recipe();
  const indexBody = index([indexEntry(r)], SKILLS_BASE);
  const skillUrl = `${SKILLS_BASE}weather.wttr/skill.json`;

  it('noStore 同时作用于索引请求与配方请求；默认两段都不带 cache 选项', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new SkillCatalogClient({ fetchImpl: fetchSource(indexBody, [r], calls) });

    const parsed = await client.fetchRegistry(REGISTRY_URL);
    await client.fetchSkill(parsed.entries[0]!);
    expect(calls.map((c) => c.url)).toEqual([REGISTRY_URL, skillUrl]);
    expect(calls.every((c) => c.init === undefined)).toBe(true);

    calls.length = 0;
    const parsed2 = await client.fetchRegistry(REGISTRY_URL, true);
    await client.fetchSkill(parsed2.entries[0]!, true);
    expect(calls.map((c) => c.url)).toEqual([REGISTRY_URL, skillUrl]);
    expect(calls.every((c) => c.init?.cache === 'no-store')).toBe(true);
  });

  it('非 JSON → 中文错误', async () => {
    const client = new SkillCatalogClient({
      fetchImpl: (async () => textResponse('<html>not json</html>')) as unknown as typeof fetch,
    });
    await expect(client.fetchRegistry(REGISTRY_URL)).rejects.toThrow('不是合法 JSON');
    await expect(client.fetchSkill({
      entry: indexEntry(r) as ParsedSkillEntry['entry'], skillUrl, baseUrl: SKILLS_BASE,
    })).rejects.toThrow('不是合法 JSON');
  });

  it('HTTP 非 2xx → 中文错误含状态码', async () => {
    const client = new SkillCatalogClient({
      fetchImpl: (async () => jsonResponse({}, false, 503)) as unknown as typeof fetch,
    });
    await expect(client.fetchRegistry(REGISTRY_URL)).rejects.toThrow('HTTP 503');
    await expect(client.fetchSkill({
      entry: indexEntry(r) as ParsedSkillEntry['entry'], skillUrl, baseUrl: SKILLS_BASE,
    })).rejects.toThrow('HTTP 503');
  });
});
