/**
 * SkillCatalogService / parseSkillRegistryIndex 契约测试（安装制，瘦索引）
 *
 * 原则：fetchImpl 打桩、localStorage 内存桩，绝不触碰真实网络 / 存储。
 * 覆盖：本地库是唯一生效来源、在线只浏览/安装、安装状态判据、缺原语拒绝、解析器边界、
 *       两段式取数（索引 + 逐条 skill.json）下「单条失败标 unavailable」的降级语义。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseSkillRecipe,
  parseSkillRegistryIndex,
} from '@application/skill/SkillRecipe';
import type { SkillPrimitive, SkillRecipe } from '@application/skill/SkillTypes';
import {
  SkillCatalogService, skillPluginResourceIds, SkillPluginInstaller,
} from '../SkillCatalogService';
import type { CatalogEntry } from '@services/plugin-catalog/PluginCatalogTypes';
import type { PluginCatalogService } from '@services/plugin-catalog/PluginCatalogService';
import type { PluginArtifactService } from '@application/plugin/PluginArtifactService';
import type { PluginArtifact } from '@domain/plugin/types';
import { UserSkillStore } from '@application/skill/dev/UserSkillStore';

/** 内存版 localStorage 桩 */
function memLocalStorage() {
  const data = new Map<string, unknown>();
  return {
    initialize: async () => {},
    read: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    write: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
  };
}

/** 注入的在线源：公网 https，能通过 validateRegistryUrl（不打真实网络） */
const ONLINE_URL = 'https://assets.example.com/skills/registry.json';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as Response;
}

function recipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'puzzle.tsumego',
    version: 4,
    name: '做题练习',
    summary: '在线做题摘要',
    primitives: ['navigate_to'],
    prompt: '调用 navigate_to 生成做题页链接。',
    ...overrides,
  };
}

/** 由完整配方生成 v2 瘦索引：重叠字段原样抄（两处解析器各自 trim/宽松处理后天然一致） */
function indexOf(recipes: Record<string, unknown>[]): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name: 'weiqi-bot skills',
    description: '测试在线源',
    // baseUrl 故意省略：让 client 的 resolveBaseUrl 用清单 URL 所在目录兜底
    skills: recipes.map((r) => {
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
      return entry;
    }),
  };
}

/**
 * 按 URL 路由的在线源桩：registry.json → 索引；<id>/skill.json → 对应配方；其余 404。
 * override(id) 可返回自定义 Response（404 / 结构不合法 / 版本不一致等），undefined 走默认配方。
 * calls 可选，用于断言 noStore 是否透传到两段每个请求。
 */
function fetchSource(
  index: Record<string, unknown>,
  recipes: Record<string, unknown>[],
  override: (id: string) => Response | undefined = () => undefined,
  calls?: Array<{ init?: RequestInit }>,
): typeof fetch {
  const byId = new Map(recipes.map((r) => [String(r['id']), r]));
  return (async (url: string, init?: RequestInit) => {
    if (calls) calls.push(init !== undefined ? { init } : {});
    if (url.endsWith('/skills/registry.json')) return jsonResponse(index);
    const match = /\/([^/]+)\/skill\.json$/.exec(url);
    if (match) {
      const id = match[1]!;
      const overridden = override(id);
      if (overridden !== undefined) return overridden;
      const body = byId.get(id);
      if (body !== undefined) return jsonResponse(body);
    }
    return jsonResponse({}, false, 404);
  }) as unknown as typeof fetch;
}

/** 常规两段式在线源：索引与配方都由同一组 recipe 生成 */
function fetchSkills(
  recipes: Record<string, unknown>[],
  override: (id: string) => Response | undefined = () => undefined,
  calls?: Array<{ init?: RequestInit }>,
): typeof fetch {
  return fetchSource(indexOf(recipes), recipes, override, calls);
}

function fetchReturning(body: unknown): typeof fetch {
  return (async () => jsonResponse(body)) as unknown as typeof fetch;
}

/** 内存本地库 + 注册表（安装校验 / 缺原语判定用） */
function usersWithMem(): UserSkillStore {
  return new UserSkillStore({ localStorage: memLocalStorage() as never });
}

function prim(name: string): SkillPrimitive {
  return {
    name,
    definition: { name, description: `${name} 说明`, parameters: { type: 'object' } },
    execute: async () => ({ observation: 'ok', ok: true, detail: name }),
  };
}

const PRIMS = new Map<string, SkillPrimitive>([
  ['navigate_to', prim('navigate_to')],
  ['web_fetch', prim('web_fetch')],
]);

function catalogWith(
  fetchImpl: typeof fetch,
  users: UserSkillStore = usersWithMem(),
): SkillCatalogService {
  const deps: {
    fetchImpl: typeof fetch; onlineUrl: string; users: UserSkillStore;
    primitives: Map<string, SkillPrimitive>;
  } = {
    fetchImpl, onlineUrl: ONLINE_URL, users, primitives: PRIMS,
  };
  return new SkillCatalogService(deps);
}

function asRecipe(raw: Record<string, unknown>): SkillRecipe {
  const parsed = parseSkillRecipe(raw);
  if (!parsed.ok) throw new Error(`测试夹具非法：${parsed.reason}`);
  return parsed.skill;
}

describe('SkillCatalogService.loadSkills — 本地库是唯一生效来源', () => {
  const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;

  it('本地库为空 → 不返回任何技能（在线源可达也不自动叠加）', async () => {
    const online = fetchReturning(indexOf([recipe()]));
    const skills = await catalogWith(online).loadSkills();
    expect(skills).toEqual([]);
  });

  it('在线源不可达 → 仍只返回本地库，静默不抛', async () => {
    const users = usersWithMem();
    await users.install(asRecipe(recipe({ id: 'puzzle.tsumego', summary: '我装过的' })));
    const skills = await catalogWith(offline, users).loadSkills();
    expect(skills.map((s) => s.id)).toEqual(['puzzle.tsumego']);
    expect(skills[0]?.summary).toBe('我装过的');
  });

  it('停用的本地条目不生效，启用的照常', async () => {
    const users = usersWithMem();
    await users.install(asRecipe(recipe({ id: 'a' })));
    await users.install(asRecipe(recipe({ id: 'b' })));
    await users.setEnabled('a', false);
    const skills = await catalogWith(offline, users).loadSkills();
    expect(skills.map((s) => s.id)).toEqual(['b']);
  });

  it('自建（skill_write 保存）与已安装两类条目都在本地库里生效', async () => {
    const users = usersWithMem();
    await users.install(asRecipe(recipe({ id: 'puzzle.tsumego' })));
    await users.save(asRecipe(recipe({
      id: 'user.mine', name: '我的技能', primitives: ['web_fetch'], 
    })));
    const skills = await catalogWith(offline, users).loadSkills();
    expect(skills.map((s) => s.id).sort()).toEqual(['puzzle.tsumego', 'user.mine']);
  });

  it('本地库读取抛错 → 当空库，绝不把异常抛到对话', async () => {
    const broken = {
      list: async () => { throw new Error('storage down'); },
    } as unknown as UserSkillStore;
    const service = new SkillCatalogService({
      fetchImpl: offline, onlineUrl: ONLINE_URL, users: broken, primitives: PRIMS,
    });
    expect(await service.loadSkills()).toEqual([]);
  });
});

describe('SkillCatalogService.browse — 在线清单 + 安装状态', () => {
  it('未安装 / 已安装 / 有更新：按同 id 与本地 version 对照', async () => {
    const users = usersWithMem();
    await users.install(asRecipe(recipe({ id: 'same', version: 4 })));
    const online = fetchSkills([
      recipe({ id: 'fresh', version: 1 }),
      recipe({ id: 'same', version: 4 }),
      recipe({ id: 'old', version: 2 }),
    ]);
    // 本地 old 装的是 v3，远端给 v2 → version 不等即「有更新」
    // （口径同插件：内容不等就是更新，不做版本号大小比较）
    await users.install(asRecipe(recipe({ id: 'old', version: 3 })));

    const { items, error, source } = await catalogWith(online, users).browse();
    expect(error).toBeUndefined();
    expect(source.official).toBe(true);
    expect(items.map((i) => [i.recipe.id, i.state])).toEqual([
      ['fresh', 'new'],
      ['same', 'installed'],
      ['old', 'update'],
    ]);
  });

  it('引用了宿主没有的原语 → unavailable，带中文原因，不给安装', async () => {
    const online = fetchSkills([
      recipe({ id: 'bad', primitives: ['not_exist'] }),
    ]);
    const { items } = await catalogWith(online).browse();
    expect(items[0]?.state).toBe('unavailable');
    expect(items[0]?.reason).toContain('not_exist');
  });

  it('某条 skill.json 结构不合法 → 该条 unavailable，其余正常显示', async () => {
    const online = fetchSkills(
      [recipe({ id: 'bad' }), recipe({ id: 'good' })],
      (id) => id === 'bad' ? jsonResponse(recipe({ id: 'bad', primitives: [] })) : undefined,
    );
    const { items, error } = await catalogWith(online).browse();
    expect(error).toBeUndefined();
    expect(items).toHaveLength(2);
    expect(items[0]?.state).toBe('unavailable');
    expect(items[0]?.reason).toContain('配方读取失败');
    expect(items[0]?.reason).toContain('格式不合法');
    // 占位卡片仍带索引里的展示字段
    expect(items[0]?.recipe.id).toBe('bad');
    expect(items[1]?.state).toBe('new');
  });

  it('索引顶层结构不合法（schemaVersion≠2 / skills 非数组）→ browse 给中文 error、items:[]', async () => {
    const badIndexes = [
      { schemaVersion: 1, name: 'x', description: 'd', skills: [] },
      { schemaVersion: 3, name: 'x', description: 'd', skills: [] },
      { schemaVersion: 2, name: 'x', description: 'd', skills: 'nope' },
    ];
    for (const badIndex of badIndexes) {
      const { items, error } = await catalogWith(fetchReturning(badIndex)).browse();
      expect(items).toEqual([]);
      expect(error).toContain('格式不合法');
    }
  });

  it('源不可达 → 空列表 + 中文 reason', async () => {
    const offline = (async () => { throw new Error('DNS 挂了'); }) as unknown as typeof fetch;
    const bad = await catalogWith(offline).browse();
    expect(bad.items).toEqual([]);
    expect(bad.error).toContain('DNS 挂了');
  });

  it('索引与 skill.json 的 version 不一致 → 该条 unavailable 且 reason 含「不一致」', async () => {
    const online = fetchSkills(
      [recipe({ id: 'bad', version: 1 }), recipe({ id: 'good' })],
      (id) => id === 'bad' ? jsonResponse(recipe({ id: 'bad', version: 7 })) : undefined,
    );
    const { items, error } = await catalogWith(online).browse();
    expect(error).toBeUndefined();
    expect(items).toHaveLength(2);
    expect(items[0]?.state).toBe('unavailable');
    expect(items[0]?.reason).toContain('不一致');
    expect(items[0]?.recipe.version).toBe(1); // 占位用索引版本
    expect(items[1]?.state).toBe('new');
  });

  it('某个 skill.json 返回 404 → 该条 unavailable 且其余正常', async () => {
    const online = fetchSkills(
      [recipe({ id: 'bad' }), recipe({ id: 'good' })],
      (id) => id === 'bad' ? jsonResponse({}, false, 404) : undefined,
    );
    const { items, error } = await catalogWith(online).browse();
    expect(error).toBeUndefined();
    expect(items).toHaveLength(2);
    expect(items[0]?.state).toBe('unavailable');
    expect(items[0]?.reason).toContain('HTTP 404');
    expect(items[1]?.state).toBe('new');
  });

  it('path 含 .. 越界 → 该条被跳过（不出现在 items 里，也不报错）', async () => {
    const recipes = [recipe({ id: 'bad' }), recipe({ id: 'good' })];
    const index = indexOf(recipes);
    (index['skills'] as Record<string, unknown>[])[0]!['path'] = '../secret.json';
    const online = fetchSource(index, recipes);
    const { items, error } = await catalogWith(online).browse();
    expect(error).toBeUndefined();
    expect(items.map((i) => i.recipe.id)).toEqual(['good']);
  });
});

describe('SkillCatalogService.install — 安装 / 更新 / 拒绝', () => {
  it('安装：写进本地库、即刻出现在 loadSkills、id/version 原样', async () => {
    const users = usersWithMem();
    const service = catalogWith(fetchReturning(indexOf([])), users);
    const out = await service.install(asRecipe(recipe({ id: 'puzzle.tsumego', version: 4 })));
    expect(out).toMatchObject({ ok: true, action: 'installed' });

    const stored = await users.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toBe('online');
    expect(stored[0]?.recipe.version).toBe(4);
    expect(stored[0]?.enabled).toBe(true);
    expect((await service.loadSkills()).map((s) => s.id)).toEqual(['puzzle.tsumego']);
  });

  it('更新：同 id 远端 version 不同 → updated，保留用户已设的停用状态', async () => {
    const users = usersWithMem();
    await users.install(asRecipe(recipe({ id: 'a', version: 1, summary: '旧' })));
    await users.setEnabled('a', false);
    const service = catalogWith(fetchReturning(indexOf([])), users);
    const out = await service.install(asRecipe(recipe({ id: 'a', version: 2, summary: '新' })));
    expect(out.action).toBe('updated');
    const stored = (await users.list())[0]!;
    expect(stored.recipe.version).toBe(2);
    expect(stored.recipe.summary).toBe('新');
    expect(stored.enabled).toBe(false);
  });

  it('缺原语 / 结构不合法 → rejected，不写本地库', async () => {
    const users = usersWithMem();
    const service = catalogWith(fetchReturning(indexOf([])), users);
    const badPrim = await service.install(
      asRecipe(recipe({ id: 'bad', primitives: ['not_exist'] })),
    );
    expect(badPrim.ok).toBe(false);
    expect(badPrim.message).toContain('not_exist');
    const badShape = await service.install(
      { ...recipe({ id: 'bad2' }), version: 0 } as unknown as SkillRecipe,
    );
    expect(badShape.ok).toBe(false);
    expect(await users.list()).toEqual([]);
  });
});

describe('parseSkillRecipe 拒绝非法配方（本地库 / skill.json 契约，保持不变）', () => {
  it('拒绝版本号非正整数 / schemaVersion 不等于 1', () => {
    expect(parseSkillRecipe(recipe({ version: 0 })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ version: 1.5 })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ schemaVersion: 2 })).ok).toBe(false);
  });

  it('拒绝空 primitives / 非法原语名', () => {
    expect(parseSkillRecipe(recipe({ primitives: [] })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ primitives: ['Web_Fetch'] })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ primitives: ['9bad'] })).ok).toBe(false);
  });

  it('拒绝缺少必填字段 / 非对象', () => {
    expect(parseSkillRecipe(recipe({ summary: '' })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ prompt: 42 })).ok).toBe(false);
    expect(parseSkillRecipe(null).ok).toBe(false);
  });
});

describe('parseSkillRegistryIndex — v2 瘦索引解析', () => {
  it('接受 v2 形状（path 相对 skills/、可选字段照抄）', () => {
    const parsed = parseSkillRegistryIndex(indexOf([
      recipe({ id: 'a' }),
      recipe({
        id: 'b', primitives: ['web_fetch', 'navigate_to'],
        routeHint: ['查天气'], category: '生活',
      }),
    ]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.registry.schemaVersion).toBe(2);
      expect(parsed.registry.skills).toHaveLength(2);
      expect(parsed.registry.skills[0]?.path).toBe('a/skill.json');
      expect(parsed.registry.skills[1]?.routeHint).toEqual(['查天气']);
      expect(parsed.registry.skills[1]?.category).toBe('生活');
      expect(parsed.registry.baseUrl).toBeUndefined();
    }
  });

  it('拒绝 schemaVersion=1 / 3，且原因点明宿主只支持 2', () => {
    for (const version of [1, 3]) {
      const parsed = parseSkillRegistryIndex({ ...indexOf([recipe()]), schemaVersion: version });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toContain('宿主只支持 2');
    }
  });

  it('拒绝 skills 非数组 / 顶层字段缺失', () => {
    expect(parseSkillRegistryIndex({ schemaVersion: 2, name: 'x', description: 'd', skills: 'nope' }).ok).toBe(false);
    expect(parseSkillRegistryIndex({ schemaVersion: 2, name: 'x', skills: [] }).ok).toBe(false);
    expect(parseSkillRegistryIndex({ schemaVersion: 2, description: 'd', skills: [] }).ok).toBe(false);
  });

  it('拒绝缺 path / path 为空串 / 非法 primitives 名', () => {
    const missingPath = indexOf([recipe({ id: 'a' })]);
    delete (missingPath['skills'] as Record<string, unknown>[])[0]!['path'];
    expect(parseSkillRegistryIndex(missingPath).ok).toBe(false);
    // path 是索引条目字段，不是配方字段：直接改 helper 生成的条目，
    // 不能塞进 recipe()（indexOf 会自己用 `${id}/skill.json` 覆盖）。
    const emptyPath = indexOf([recipe()]);
    (emptyPath['skills'] as Record<string, unknown>[])[0]!['path'] = '';
    expect(parseSkillRegistryIndex(emptyPath).ok).toBe(false);
    expect(parseSkillRegistryIndex(indexOf([recipe({ primitives: ['Web_Fetch'] })])).ok).toBe(false);
  });

  it('接受 primitives:[]（workflow 配方，索引层看不到 workflow 声明）', () => {
    const parsed = parseSkillRegistryIndex(indexOf([recipe({ primitives: [] })]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.registry.skills[0]?.primitives).toEqual([]);
  });

  it('接受可选 routeHint / category / baseUrl 缺省', () => {
    const parsed = parseSkillRegistryIndex(indexOf([recipe({ id: 'a' })]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.registry.skills[0]?.routeHint).toBeUndefined();
      expect(parsed.registry.skills[0]?.category).toBeUndefined();
      expect(parsed.registry.baseUrl).toBeUndefined();
    }
    // 显式 baseUrl 也接受（指向 skills/ 目录）
    expect(parseSkillRegistryIndex({
      ...indexOf([]), baseUrl: 'https://assets.example.com/skills/',
    }).ok).toBe(true);
    // baseUrl 非字符串则拒绝
    expect(parseSkillRegistryIndex({ ...indexOf([]), baseUrl: 42 }).ok).toBe(false);
  });
});

// ---------- 依赖插件自动安装/启用编排（2026-11-25） ----------

function wfRecipe(calls: string[]): SkillRecipe {
  // parseSkillRecipe 允许 primitives:[] 的前提是同一份 raw 里带 workflow 声明；
  // 先解析再加 workflow 会被「散文配方必须至少 1 条原语」拒掉。
  return asRecipe(recipe({
    id: 'circle.foxwq', primitives: [],
    workflow: { steps: calls.map((call, i) => ({ id: `s${i}`, call })) },
  }));
}

function pluginEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    registryUrl: 'https://assets.example.com/registry.json', official: true,
    resourceId: 'workflow-operator.circle', kind: 'plugin', name: '弈友圈关系算子',
    summary: '关系算子', state: 'new', remoteCode: 'export function normalize() {}',
    ...overrides,
  };
}

function localArtifact(overrides: Partial<PluginArtifact> = {}): PluginArtifact {
  return {
    id: 'art-circle', name: '弈友圈关系算子', pointId: 'workflow-operator',
    enabled: false, catalogRef: {
      registryUrl: 'https://assets.example.com/registry.json',
      resourceId: 'workflow-operator.circle',
    },
    ...overrides,
  } as unknown as PluginArtifact;
}

function fakePluginCatalog(
  entries: CatalogEntry[],
  install: (e: CatalogEntry) => Promise<{ ok: boolean; action: string; message: string; artifact?: PluginArtifact }> =
    async () => ({ ok: true, action: 'installed', message: '已安装', artifact: localArtifact({ enabled: true }) }),
): PluginCatalogService {
  return {
    browseResources: async (resourceIds: readonly string[]) => ({
      entries: entries.filter((entry) => resourceIds.includes(entry.resourceId)), failures: [],
    }),
    install,
  } as unknown as PluginCatalogService;
}

function fakeArtifacts(list: PluginArtifact[]) {
  const setEnabled = vi.fn(async (_id: string, _enabled: boolean) => {});
  const service = {
    list: async () => list,
    setEnabled,
  } as unknown as PluginArtifactService;
  return { service, setEnabled };
}

describe('skillPluginResourceIds — 从 workflow DAG 推导依赖插件', () => {
  it('插件算子 <slug>.<method> → workflow-operator.<slug>，去重保序；内置算子不含点被忽略', () => {
    expect(skillPluginResourceIds(wfRecipe([
      'foxwq_fetch_batch', 'circle.normalize', 'circle.stats', 'calendar.lookup',
    ]))).toEqual(['workflow-operator.circle', 'workflow-operator.calendar']);
  });

  it('散文配方（无 workflow）/ 只调内置算子 → 零依赖，进而不弹框', () => {
    expect(skillPluginResourceIds(asRecipe(recipe()))).toEqual([]);
    expect(skillPluginResourceIds(wfRecipe(['json_extract', 'display_json_list']))).toEqual([]);
  });
});

describe('SkillPluginInstaller.plan — 只读推导', () => {
  it('自建算子插件（有 slug、无 catalogRef）已启用 → 零动作、零网络请求', async () => {
    let browsed = false;
    const catalog = {
      browseResources: async () => { browsed = true; return { entries: [], failures: [] }; },
    } as unknown as PluginCatalogService;
    const installer = new SkillPluginInstaller({
      catalog,
      artifacts: fakeArtifacts([localArtifact({
        enabled: true, slug: 'circle', catalogRef: undefined,
      })]).service,
    });
    const plan = await installer.plan(wfRecipe(['circle.normalize']));
    expect(plan.actions).toEqual([]);
    expect(plan.blockers).toEqual([]);
    expect(plan.resourceIds).toEqual(['workflow-operator.circle']);
    expect(browsed).toBe(false);
  });

  it('在线装来的依赖已启用且远端 state=installed（当前版本）→ 核对一次后仍零动作', async () => {
    const installer = new SkillPluginInstaller({
      catalog: fakePluginCatalog([pluginEntry({ state: 'installed' })]),
      artifacts: fakeArtifacts([localArtifact({ enabled: true })]).service,
    });
    const plan = await installer.plan(wfRecipe(['circle.normalize']));
    expect(plan.actions).toEqual([]);
    expect(plan.blockers).toEqual([]);
  });

  it('在线装来的依赖已启用但远端 state=update → 列「更新并启用」动作（进弹框）', async () => {
    const installer = new SkillPluginInstaller({
      catalog: fakePluginCatalog([pluginEntry({ state: 'update', name: '弈友圈关系算子 v2' })]),
      artifacts: fakeArtifacts([localArtifact({ enabled: true })]).service,
    });
    const plan = await installer.plan(wfRecipe(['circle.normalize']));
    expect(plan.actions).toEqual([{
      resourceId: 'workflow-operator.circle', slug: 'circle',
      name: '弈友圈关系算子 v2', kind: 'update',
    }]);
    expect(plan.installEntries.size).toBe(1);
    expect(plan.blockers).toEqual([]);
  });

  it('本地已有但停用 → 只 enable、不安装、不联网', async () => {
    let browsed = false;
    const catalog = {
      browse: async () => { browsed = true; return { entries: [], failures: [] }; },
    } as unknown as PluginCatalogService;
    const art = localArtifact({ enabled: false });
    const installer = new SkillPluginInstaller({ catalog, artifacts: fakeArtifacts([art]).service });
    const plan = await installer.plan(wfRecipe(['circle.normalize']));
    expect(plan.actions).toEqual([{
      resourceId: 'workflow-operator.circle', slug: 'circle', name: '弈友圈关系算子',
      kind: 'enable', artifactId: 'art-circle',
    }]);
    expect(browsed).toBe(false);
  });

  it('缺件 → 从在线源安装；更新态标 update；已装停用 + 缺件并存', async () => {
    const entries = [
      pluginEntry({ state: 'new' }),
      pluginEntry({ resourceId: 'workflow-operator.calendar', name: '日历算子', state: 'update' }),
    ];
    const installer = new SkillPluginInstaller({
      catalog: fakePluginCatalog(entries),
      artifacts: fakeArtifacts([localArtifact({
        id: 'art-cal', name: '日历算子', enabled: false,
        catalogRef: { registryUrl: 'https://assets.example.com/registry.json', resourceId: 'workflow-operator.calendar' },
      })]).service,
    });
    const plan = await installer.plan(wfRecipe(['circle.normalize', 'calendar.lookup']));
    expect(plan.blockers).toEqual([]);
    expect(plan.actions.map((a) => [a.resourceId, a.kind])).toEqual([
      // circle 缺件 → install；calendar 本地已装停用 → 只 enable（不更新、不重装）
      ['workflow-operator.circle', 'install'],
      ['workflow-operator.calendar', 'enable'],
    ]);
    expect(plan.installEntries.size).toBe(1);
  });

  it('在线源找不到 / 条目不可装 / 插件系统未装配 → blockers（UI 据此拒绝装技能）', async () => {
    const missing = new SkillPluginInstaller({
      catalog: fakePluginCatalog([]), artifacts: fakeArtifacts([]).service,
    });
    expect((await missing.plan(wfRecipe(['circle.normalize']))).blockers[0]).toContain('找不到依赖插件');

    const incompatible = new SkillPluginInstaller({
      catalog: fakePluginCatalog([pluginEntry({ state: 'incompatible', reason: 'specVersion 不符' })]),
      artifacts: fakeArtifacts([]).service,
    });
    expect((await incompatible.plan(wfRecipe(['circle.normalize']))).blockers[0]).toContain('不可安装');

    const uninstalled = new SkillPluginInstaller();
    expect((await uninstalled.plan(wfRecipe(['circle.normalize']))).blockers[0]).toContain('插件系统未就绪');
    // 散文配方零依赖：哪怕插件系统没装也不该拦
    expect(await uninstalled.plan(asRecipe(recipe()))).toMatchObject({ actions: [], blockers: [] });
  });
});

describe('SkillPluginInstaller.apply — 确认后才写', () => {
  it('install 动作：调用 catalog.install + setEnabled(true)，如实回执', async () => {
    const install = vi.fn(async () => ({
      ok: true, action: 'installed', message: '已安装',
      artifact: localArtifact({ enabled: false }),
    }));
    const { service: artifacts, setEnabled } = fakeArtifacts([]);
    const installer = new SkillPluginInstaller({
      catalog: fakePluginCatalog([pluginEntry()], install), artifacts,
    });
    const plan = await installer.plan(wfRecipe(['circle.normalize']));
    const out = await installer.apply(plan);
    expect(install).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith('art-circle', true);
    expect(out.ok).toBe(true);
    expect(out.installed).toEqual(['弈友圈关系算子']);
    expect(out.enabled).toEqual(['弈友圈关系算子']);
  });

  it('enable 动作：只启用，不调用在线安装', async () => {
    let installed = 0;
    const { service: artifacts, setEnabled } = fakeArtifacts([localArtifact({ enabled: false })]);
    const installer = new SkillPluginInstaller({
      catalog: fakePluginCatalog([], async () => { installed += 1; return { ok: true, action: 'installed', message: '' }; }),
      artifacts,
    });
    const plan = await installer.plan(wfRecipe(['circle.normalize']));
    const out = await installer.apply(plan);
    expect(installed).toBe(0);
    expect(setEnabled).toHaveBeenCalledWith('art-circle', true);
    expect(out.ok).toBe(true);
    expect(out.installed).toEqual([]);
    expect(out.enabled).toEqual(['弈友圈关系算子']);
  });

  it('failures / blockers → ok:false，不抛；plan 未经确认不会被本类自动调用', async () => {
    const fail = new SkillPluginInstaller({
      catalog: fakePluginCatalog([pluginEntry()], async () => ({ ok: false, action: 'rejected', message: '试跑不通过' })),
      artifacts: fakeArtifacts([]).service,
    });
    const plan = await fail.plan(wfRecipe(['circle.normalize']));
    const out = await fail.apply(plan);
    expect(out.ok).toBe(false);
    expect(out.failures[0]).toContain('试跑不通过');
    expect(out.enabled).toEqual([]);

    // blockers 场景用「已装配但在线源找不到」的 installer：
    // apply 先保证 catalog/artifacts 在，再如实汇总 blockers，不抛。
    const blockedInstaller = new SkillPluginInstaller({
      catalog: fakePluginCatalog([]), artifacts: fakeArtifacts([]).service,
    });
    const blocked = await blockedInstaller.plan(wfRecipe(['circle.normalize']));
    expect(blocked.blockers.length).toBeGreaterThan(0);
    const blockedOut = await blockedInstaller.apply(blocked);
    expect(blockedOut.ok).toBe(false);
    expect(blockedOut.message).toContain('存在无法自动满足的依赖');
  });
});

describe('SkillCatalogService.browse — 手动刷新绕过 HTTP 缓存', () => {
  it('默认 browse() 两段所有请求都不带 cache 选项；browse(true) 每个都带 cache:no-store', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const recipes = [recipe({ id: 'fresh', version: 1 })];
    const catalog = catalogWith(fetchSkills(recipes, undefined, calls));
    // 索引 1 次 + 每条配方 1 次
    const expectedCalls = 1 + recipes.length;

    await catalog.browse();
    expect(calls).toHaveLength(expectedCalls);
    expect(calls.every((c) => c.init === undefined)).toBe(true);

    calls.length = 0;
    const { items } = await catalog.browse(true);
    expect(items).toHaveLength(1);
    expect(calls).toHaveLength(expectedCalls);
    expect(calls.every((c) => c.init?.cache === 'no-store')).toBe(true);
  });
});


// ---------- 分类标签（2026-11-21）：可选字段，宽松解析，安装落库 ----------
describe('分类标签 category（可选、纯展示）', () => {
  it('parseSkillRecipe 保留合法 category，缺省 / 空串 / 非字符串一律当没写', () => {
    const withCat = parseSkillRecipe(recipe({ category: '财经' }));
    expect(withCat.ok).toBe(true);
    if (withCat.ok) expect(withCat.skill.category).toBe('财经');
    const trimmed = parseSkillRecipe(recipe({ category: '  围棋  ' }));
    expect(trimmed.ok).toBe(true);
    if (trimmed.ok) expect(trimmed.skill.category).toBe('围棋');
    for (const raw of [undefined, '', 42, null]) {
      const parsed = parseSkillRecipe(recipe({ category: raw }));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.skill.category).toBeUndefined();
    }
  });

  it('未知 category 值不拒配方（交给 UI 兜底推导），索引层宽松解析', () => {
    const parsed = parseSkillRegistryIndex(indexOf([
      recipe({ id: 'a', category: '火星' }),
      recipe({ id: 'b', category: '财经' }),
    ]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.registry.skills[0]?.category).toBe('火星');
      expect(parsed.registry.skills[1]?.category).toBe('财经');
    }
  });

  it('在线安装把 category 写进本地库；老配方没写也不影响安装', async () => {
    const withCat = recipe({ id: 'stock.quote', category: '财经', version: 2 });
    const withoutCat = recipe({ id: 'puzzle.tsumego', version: 2 });
    const catalog = catalogWith(fetchSkills([withCat, withoutCat]));
    const { items } = await catalog.browse();
    expect(items.map((i) => i.recipe.category)).toEqual(['财经', undefined]);
    const out1 = await catalog.install(items[0]!.recipe);
    const out2 = await catalog.install(items[1]!.recipe);
    expect(out1.ok).toBe(true);
    expect(out2.ok).toBe(true);
    const saved = await catalog.userStore().list();
    expect(saved.find((e) => e.recipe.id === 'stock.quote')?.recipe.category).toBe('财经');
    expect(saved.find((e) => e.recipe.id === 'puzzle.tsumego')?.recipe.category).toBeUndefined();
  });
});
