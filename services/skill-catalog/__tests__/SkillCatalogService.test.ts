/**
 * SkillCatalogService / parseSkillRegistry 契约测试（安装制）
 *
 * 原则：fetchImpl 打桩、localStorage 内存桩，绝不触碰真实网络 / 存储。
 * 覆盖：本地库是唯一生效来源、在线只浏览/安装、安装状态判据、缺原语拒绝、解析器边界。
 */

import { describe, it, expect } from 'vitest';
import {
  parseSkillRecipe,
  parseSkillRegistry,
} from '@application/skill/SkillRecipe';
import type { SkillPrimitive, SkillRecipe } from '@application/skill/SkillTypes';
import { SkillCatalogService } from '../SkillCatalogService';
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

function registryOf(skills: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: 'weiqi-bot skills',
    description: '测试在线源',
    skills,
  };
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
  capabilities?: () => Promise<readonly string[]>,
): SkillCatalogService {
  const deps: {
    fetchImpl: typeof fetch; onlineUrl: string; users: UserSkillStore;
    primitives: Map<string, SkillPrimitive>; capabilities?: () => Promise<readonly string[]>;
  } = {
    fetchImpl, onlineUrl: ONLINE_URL, users, primitives: PRIMS,
  };
  if (capabilities !== undefined) deps.capabilities = capabilities;
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
    const online = fetchReturning(registryOf([recipe()]));
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
    const online = fetchReturning(registryOf([
      recipe({ id: 'fresh', version: 1 }),
      recipe({ id: 'same', version: 4 }),
      recipe({ id: 'old', version: 2 }),
    ]));
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
    const online = fetchReturning(registryOf([
      recipe({ id: 'bad', primitives: ['not_exist'] }),
    ]));
    const { items } = await catalogWith(online).browse();
    expect(items[0]?.state).toBe('unavailable');
    expect(items[0]?.reason).toContain('not_exist');
  });

  it('整份清单含结构不合法配方 → 校验层拒绝，browse 给中文 error 而非空白屏', async () => {
    const online = fetchReturning(registryOf([
      recipe({ id: 'bad', primitives: [] }),
      recipe({ id: 'good' }),
    ]));
    const { items, error } = await catalogWith(online).browse();
    expect(items).toEqual([]);
    expect(error).toContain('格式不合法');
  });

  it('源不可达 → 空列表 + 中文 reason', async () => {
    const offline = (async () => { throw new Error('DNS 挂了'); }) as unknown as typeof fetch;
    const bad = await catalogWith(offline).browse();
    expect(bad.items).toEqual([]);
    expect(bad.error).toContain('DNS 挂了');
  });
});

describe('SkillCatalogService.install — 安装 / 更新 / 拒绝', () => {
  it('安装：写进本地库、即刻出现在 loadSkills、id/version 原样', async () => {
    const users = usersWithMem();
    const service = catalogWith(fetchReturning(registryOf([])), users);
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
    const service = catalogWith(fetchReturning(registryOf([])), users);
    const out = await service.install(asRecipe(recipe({ id: 'a', version: 2, summary: '新' })));
    expect(out.action).toBe('updated');
    const stored = (await users.list())[0]!;
    expect(stored.recipe.version).toBe(2);
    expect(stored.recipe.summary).toBe('新');
    expect(stored.enabled).toBe(false);
  });

  it('缺原语 / 结构不合法 → rejected，不写本地库', async () => {
    const users = usersWithMem();
    const service = catalogWith(fetchReturning(registryOf([])), users);
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

describe('requiredCapabilities — 面板 browse / install 与对话侧同源判定', () => {
  /** 依赖 monthCalendar 的在线配方（原语用默认的 navigate_to，注册表里有） */
  const needsMonth = () => recipe({ id: 'calendar.monthly', requiredCapabilities: ['monthCalendar'] });
  const okCaps = async () => ['monthCalendar', 'solarTerms'] as const;
  const noCaps = async () => [] as readonly string[];
  const throwCaps = async (): Promise<readonly string[]> => { throw new Error('工件存储炸了'); };

  it('browse：注入清单但缺依赖 → unavailable，中文原因点名缺哪个方法', async () => {
    const { items } = await catalogWith(
      fetchReturning(registryOf([needsMonth()])), usersWithMem(), noCaps,
    ).browse();
    expect(items[0]?.state).toBe('unavailable');
    expect(items[0]?.reason).toContain('monthCalendar');
  });

  it('browse：依赖齐备 → 正常按同 id/version 判状态（本地空 → new）', async () => {
    const { items } = await catalogWith(
      fetchReturning(registryOf([needsMonth()])), usersWithMem(), okCaps,
    ).browse();
    expect(items[0]?.state).toBe('new');
  });

  it('browse：注入了检查器但取值抛错 → 按空集严格判缺（绝不静默放行）', async () => {
    const { items } = await catalogWith(
      fetchReturning(registryOf([needsMonth()])), usersWithMem(), throwCaps,
    ).browse();
    expect(items[0]?.state).toBe('unavailable');
    expect(items[0]?.reason).toContain('monthCalendar');
  });

  it('browse：完全没注入检查器 → 不检查依赖（保守放行，不假装有清单）', async () => {
    const { items } = await catalogWith(
      fetchReturning(registryOf([needsMonth()])), usersWithMem(),
    ).browse();
    expect(items[0]?.state).toBe('new');
  });

  it('install：缺依赖 → rejected，不写本地库，提示去插件面板', async () => {
    const users = usersWithMem();
    const service = catalogWith(fetchReturning(registryOf([])), users, noCaps);
    const out = await service.install(asRecipe(needsMonth()));
    expect(out.ok).toBe(false);
    expect(out.message).toContain('monthCalendar');
    expect(await users.list()).toEqual([]);
  });

  it('install：注入检查器但取值抛错 → 按空集判缺，拒装', async () => {
    const users = usersWithMem();
    const service = catalogWith(fetchReturning(registryOf([])), users, throwCaps);
    const out = await service.install(asRecipe(needsMonth()));
    expect(out.ok).toBe(false);
    expect(await users.list()).toEqual([]);
  });

  it('install：依赖齐备 → 正常安装', async () => {
    const users = usersWithMem();
    const service = catalogWith(fetchReturning(registryOf([])), users, okCaps);
    const out = await service.install(asRecipe(needsMonth()));
    expect(out).toMatchObject({ ok: true, action: 'installed' });
    expect((await users.list())[0]?.recipe.requiredCapabilities).toEqual(['monthCalendar']);
  });

  it('install：没注入检查器 → 不检查依赖，照常安装', async () => {
    const users = usersWithMem();
    const service = catalogWith(fetchReturning(registryOf([])), users);
    const out = await service.install(asRecipe(needsMonth()));
    expect(out.ok).toBe(true);
  });

  it('parseSkillRecipe：空数组 / 非标识符 / 非数组一律拒绝，缺省字段放行', () => {
    expect(parseSkillRecipe(recipe({ requiredCapabilities: [] })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ requiredCapabilities: ['bad-name'] })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ requiredCapabilities: 'monthCalendar' })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ requiredCapabilities: [1] })).ok).toBe(false);
    const ok = parseSkillRecipe(recipe({ requiredCapabilities: ['monthCalendar'] }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.skill.requiredCapabilities).toEqual(['monthCalendar']);
    // 缺省字段不出现在解析结果里（exactOptionalPropertyTypes）
    const plain = parseSkillRecipe(recipe());
    if (plain.ok) expect('requiredCapabilities' in plain.skill).toBe(false);
  });
});

describe('parseSkillRegistry / parseSkillRecipe 拒绝非法配方', () => {
  it('接受契约 §7.6 形状的完整清单', () => {
    const valid = registryOf([
      recipe({ id: 'a' }),
      recipe({ id: 'b', primitives: ['web_fetch', 'navigate_to'] }),
    ]);
    const parsed = parseSkillRegistry(valid);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.registry.skills).toHaveLength(2);
  });

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

  it('拒绝缺少必填字段 / skills 非数组 / 顶层字段缺失', () => {
    expect(parseSkillRecipe(recipe({ summary: '' })).ok).toBe(false);
    expect(parseSkillRegistry({ schemaVersion: 1, name: 'x', description: 'd', skills: 'nope' }).ok).toBe(false);
    expect(parseSkillRegistry({ schemaVersion: 1, name: 'x', skills: [] }).ok).toBe(false);
    expect(parseSkillRegistry(registryOf([recipe({ prompt: 42 })])).ok).toBe(false);
    expect(parseSkillRecipe(null).ok).toBe(false);
  });
});

describe('SkillCatalogService.browse — 手动刷新绕过 HTTP 缓存', () => {
  it('默认 browse() 不带 cache 选项；browse(true) 给请求带 cache:no-store', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(init !== undefined ? { init } : {});
      return jsonResponse(registryOf([recipe({ id: 'fresh', version: 1 })]));
    }) as unknown as typeof fetch;
    const catalog = catalogWith(fetchImpl);

    await catalog.browse();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init).toBeUndefined();

    calls.length = 0;
    const { items } = await catalog.browse(true);
    expect(items).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.cache).toBe('no-store');
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

  it('未知 category 值不拒配方（交给 UI 兜底推导），整份 registry 照样解析', () => {
    const parsed = parseSkillRegistry(registryOf([
      recipe({ id: 'a', category: '火星' }),
      recipe({ id: 'b', category: '财经' }),
    ]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.registry.skills[0]!.category).toBe('火星');
      expect(parsed.registry.skills[1]!.category).toBe('财经');
    }
  });

  it('在线安装把 category 写进本地库；老配方没写也不影响安装', async () => {
    const withCat = recipe({ id: 'stock.quote', category: '财经', version: 2 });
    const withoutCat = recipe({ id: 'puzzle.tsumego', version: 2 });
    const catalog = catalogWith(fetchReturning(registryOf([withCat, withoutCat])));
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
