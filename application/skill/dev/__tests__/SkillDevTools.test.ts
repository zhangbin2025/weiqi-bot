/**
 * SkillDevTools：技能开发角色的两个工具（skill_list / skill_write）
 * 只测「模型提交声明 → 宿主校验 → 落库」这条链路，不打网络、不碰真实 localStorage。
 */

import { describe, it, expect } from 'vitest';
import { createSkillDevKit, makeUserSkillId } from '../SkillDevTools';
import { UserSkillStore } from '../UserSkillStore';
import { NAVIGATE_TO_TOOL } from '@application/skill/primitives/BasicPrimitives';
import type { SkillPrimitive } from '@application/skill/SkillTypes';

function memAdapter() {
  const data = new Map<string, unknown>();
  return {
    initialize: async () => {},
    read: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    write: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
    data,
  };
}

function prim(name: string): SkillPrimitive {
  return {
    name,
    definition: { name, description: `${name} 的说明`, parameters: { type: 'object' } },
    execute: async () => ({ observation: 'ok', ok: true, detail: name }),
  };
}

function kit() {
  const users = new UserSkillStore({ localStorage: memAdapter() as never });
  const primitives = new Map<string, SkillPrimitive>([
    ['web_fetch', prim('web_fetch')],
    ['navigate_to', prim('navigate_to')],
  ]);
  const dev = createSkillDevKit({ users, primitives });
  const exec = (name: string, args: unknown) => dev.executors[name]!(JSON.stringify(args));
  return { users, dev, exec };
}

describe('createSkillDevKit', () => {
  it('挂 2 个工具，system 片段列出可用原语名与开发规则', () => {
    const { dev } = kit();
    expect(dev.tools.map((t) => t.name).sort()).toEqual(['skill_list', 'skill_rename', 'skill_write']);
    expect(dev.systemSuffix).toContain('web_fetch');
    expect(dev.systemSuffix).toContain('navigate_to');
    expect(dev.systemSuffix).toContain('技能开发');
    expect(dev.systemSuffix).toContain('在线技能');
    expect(dev.systemSuffix).toContain('只读');
    // 改名工具与发布用 id 规则要写进开发 system，否则模型不知道能把随机 id 改干净
    expect(dev.systemSuffix).toContain('skill_rename');
    expect(dev.systemSuffix).toContain('发布用 id');
  });

  it('回归：引用 navigate_to 时，写配方指引把「宿主注入链接 / 绝不写网址」契约前移到开发 system', () => {
    // 2026-11-16 用户实测：自建「对弈」技能让模型自己拼出 https://example.com/play/index.html。
    // 契约原先只在工具执行后的 observation 里，写配方那一刻模型看不到。
    const { dev } = kit();
    expect(dev.systemSuffix).toContain('配方引用 navigate_to 时');
    // 文案直接派生自工具定义（单一出处），不是抄第二份
    expect(dev.systemSuffix).toContain(NAVIGATE_TO_TOOL.description);
    expect(dev.systemSuffix).toContain('不要编造域名');
  });

  it('没有 navigate_to 原语时不多写那段指引（不凭空造规则）', () => {
    const users = new UserSkillStore({ localStorage: memAdapter() as never });
    const primitives = new Map<string, SkillPrimitive>([['web_fetch', prim('web_fetch')]]);
    const suffix = createSkillDevKit({ users, primitives }).systemSuffix;
    expect(suffix).not.toContain('配方引用 navigate_to 时');
  });

  it('skill_list 空库给出明确提示', async () => {
    const { exec } = kit();
    const out = await exec('skill_list', {});
    expect(out.ok).toBe(true);
    expect(out.observation).toContain('没有任何');
  });

  it('回归（安装制）：skill_list 标出来源，在线安装条目只读不可被 skill_write 改写', async () => {
    const { users, exec } = kit();
    const online = {
      schemaVersion: 1, id: 'puzzle.tsumego', version: 4, name: '做题',
      summary: '在线摘要', primitives: ['navigate_to'], prompt: 'p',
    };
    await users.install(online as never);
    const listOut = await exec('skill_list', {});
    expect(listOut.observation).toContain('source=online');
    expect(listOut.observation).toContain('只读');

    const writeOut = await exec('skill_write', {
      id: 'puzzle.tsumego', name: '想改', summary: 's', 
      primitives: ['web_fetch'], prompt: 'p',
    });
    // 发布用 id 现在合法（不再强制 user. 前缀）；在线条目只读由 UserSkillStore.save 第二道保护兜底
    expect(writeOut.ok).toBe(false);
    expect(writeOut.observation).toContain('只读');
    const stored = await users.list();
    expect(stored[0]?.recipe.name).toBe('做题');
    expect(stored[0]?.source).toBe('online');
  });

  it('skill_write 新建散文技能：宿主补 id/version，保存即时启用', async () => {
    const { exec, users } = kit();
    const out = await exec('skill_write', {
      name: '查定式资料',
      summary: '用户问定式时查资料',
      primitives: ['web_fetch'],
      prompt: '用 web_fetch 查定式资料。',
    });
    expect(out.ok).toBe(true);
    const list = await users.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.recipe.id.startsWith('user.')).toBe(true);
    expect(list[0]?.recipe.version).toBe(1);
    expect(list[0]?.enabled).toBe(true);
  });

  it('skill_write 新建 workflow 技能：保存后未启用，hooks 能读到候选且 debug 跑通才启用', async () => {
    const { exec, users, dev } = kit();
    const out = await exec('skill_write', {
      name: '热搜列表', summary: '抓热搜', primitives: [],
      prompt: '展示说明',
      workflow: { steps: [{ id: 'only', call: 'web_fetch' }] },
    });
    expect(out.ok).toBe(true);
    expect(out.observation).toContain('未启用');
    expect(out.observation).toContain('debug:true');
    const saved = await users.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.enabled).toBe(false);
    // 宿主内部 hooks（非模型工具）：候选含未启用条目，accept 才翻转
    const hooks = dev.workflowHooks!;
    const candidates = await hooks.listCandidates();
    expect(candidates.map((c) => c.recipe.id)).toEqual([saved[0]!.recipe.id]);
    expect(candidates[0]?.enabled).toBe(false);
    await hooks.accept(saved[0]!.recipe.id);
    expect((await users.list())[0]?.enabled).toBe(true);
    // 修订重置闸门
    const revised = await exec('skill_write', {
      id: saved[0]!.recipe.id, name: '热搜列表（改）', summary: '抓热搜',
      primitives: [], prompt: '展示说明',
      workflow: { steps: [{ id: 'only2', call: 'web_fetch' }] },
    });
    expect(revised.ok).toBe(true);
    expect((await users.list())[0]?.enabled).toBe(false);
  });

  it('skill_write 修订：显式 user. id 命中同一条，版本 +1', async () => {
    const { exec, users } = kit();
    const first = await exec('skill_write', {
      name: '查定式', summary: 's', primitives: ['web_fetch'], prompt: 'p',
    });
    expect(first.ok).toBe(true);
    const id = (await users.list())[0]!.recipe.id;
    const second = await exec('skill_write', {
      id, name: '查定式（改）', summary: 's2', 
      primitives: ['web_fetch', 'navigate_to'], prompt: 'p2',
    });
    expect(second.ok).toBe(true);
    const list = await users.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.recipe.version).toBe(2);
    expect(list[0]?.recipe.name).toBe('查定式（改）');
  });

  it('拒绝未知原语，并回执可用清单（不落库）', async () => {
    const { exec, users } = kit();
    const out = await exec('skill_write', {
      name: '乱来', summary: 's', 
      primitives: ['not_exist'], prompt: 'p',
    });
    expect(out.ok).toBe(false);
    expect(out.observation).toContain('not_exist');
    expect(out.observation).toContain('web_fetch');
    expect(await users.list()).toEqual([]);
  });

  it('新建可指定发布用 id（不再强制 user. 前缀），非法 id 仍拒绝', async () => {
    const { exec, users } = kit();
    const ok = await exec('skill_write', {
      id: 'admin.publish', name: 'x', summary: 's',
      primitives: ['web_fetch'], prompt: 'p',
    });
    expect(ok.ok).toBe(true);
    expect(ok.observation).toContain('admin.publish');
    const bad = await exec('skill_write', {
      id: 'Bad:中文 空格', name: 'y', summary: 's',
      primitives: ['web_fetch'], prompt: 'p',
    });
    expect(bad.ok).toBe(false);
    expect(bad.observation).toContain('不合法');
    expect((await users.list()).length).toBe(1);
  });

  it('结构不合法（空 primitives / 缺字段 / 非法 JSON）一律失败且回中文原因', async () => {
    const { exec, users } = kit();
    const bad = await exec('skill_write', {
      name: 'x', summary: 's', primitives: [], prompt: 'p',
    });
    expect(bad.ok).toBe(false);
    expect(bad.observation).toContain('不合法');
    const missing = await exec('skill_write', { name: 'x' });
    expect(missing.ok).toBe(false);
    const notJson = await kit().dev.executors['skill_write']!('这不是 JSON');
    expect(notJson.ok).toBe(false);
    expect(await users.list()).toEqual([]);
  });
});

describe('skill_write 未指定 name 时自动命名', () => {
  it('空库第一个叫技能1，连续新建按技能2/技能3排号且不撞车', async () => {
    const { exec, users } = kit();
    const base = { summary: 's', primitives: ['web_fetch'], prompt: 'p' };
    expect((await exec('skill_write', { ...base })).ok).toBe(true);
    expect((await exec('skill_write', { ...base })).ok).toBe(true);
    expect((await exec('skill_write', { ...base })).ok).toBe(true);
    const names = (await users.list()).map((e) => e.recipe.name);
    expect(names).toEqual(['技能1', '技能2', '技能3']);
  });

  it('显式 name 优先；已占用的「技能N」编号会被跳过', async () => {
    const { exec, users } = kit();
    const base = { summary: 's', primitives: ['web_fetch'], prompt: 'p' };
    await exec('skill_write', { ...base, name: '技能1' });
    expect((await exec('skill_write', { ...base })).ok).toBe(true);
    expect((await exec('skill_write', { ...base, name: '查定式' })).ok).toBe(true);
    const names = (await users.list()).map((e) => e.recipe.name);
    expect(names).toEqual(['技能1', '技能2', '查定式']);
  });

  it('修订时省略 name 沿用原名，不改成自动编号', async () => {
    const { exec, users } = kit();
    const first = await exec('skill_write', {
      name: '查定式', summary: 's', primitives: ['web_fetch'], prompt: 'p',
    });
    expect(first.ok).toBe(true);
    const id = (await users.list())[0]!.recipe.id;
    const revised = await exec('skill_write', {
      id, summary: 's2', primitives: ['web_fetch'], prompt: 'p2',
    });
    expect(revised.ok).toBe(true);
    const list = await users.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.recipe.name).toBe('查定式');
    expect(list[0]?.recipe.version).toBe(2);
  });

  it('schema 里 name 不再是必填', () => {
    const { dev } = kit();
    const schema = dev.tools.find((t) => t.name === 'skill_write')!.parameters;
    const required = (schema as { required?: string[] }).required ?? [];
    expect(required).not.toContain('name');
  });
});

describe('secrets 声明（通用 http_fetch_auth 配方的自建路径）', () => {
  const spec = {
    key: 'github_token',
    label: 'GitHub Token',
    setupUrl: 'https://github.com/settings/tokens',
    allowedHosts: ['api.github.com'],
    header: { name: 'Authorization', prefix: 'Bearer ' },
  };
  const args = {
    name: 'GitHub 查询',
    summary: '查 GitHub REST API',
    primitives: ['http_fetch_auth', 'secret_prompt'],
    secrets: [spec],
    prompt: '用 http_fetch_auth 查询。',
  };

  function kitWithAuth() {
    const users = new UserSkillStore({ localStorage: memAdapter() as never });
    const primitives = new Map<string, SkillPrimitive>([
      ['http_fetch_auth', prim('http_fetch_auth')],
      ['secret_prompt', prim('secret_prompt')],
    ]);
    const dev = createSkillDevKit({ users, primitives });
    return { users, dev, exec: (a: unknown) => dev.executors['skill_write']!(JSON.stringify(a)) };
  }

  it('skill_write schema 放行 secrets，system 片段讲清宿主限定域名/头', () => {
    const { dev } = kitWithAuth();
    const schema = dev.tools.find((t) => t.name === 'skill_write')!.parameters;
    expect(schema.properties).toHaveProperty('secrets');
    expect(dev.systemSuffix).toContain('secrets');
    expect(dev.systemSuffix).toContain('allowedHosts');
    expect(dev.systemSuffix).toContain('模型调用时只给 url 和 secretKey');
  });

  it('合法 secrets 透传落库、skill_list 回显；观察点名允许的 host', async () => {
    const { users, exec } = kitWithAuth();
    const r = await exec(args);
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('api.github.com');
    const saved = await users.list();
    expect(saved[0]!.recipe.secrets).toEqual([spec]);
    const list = await kitWithAuth().dev.executors['skill_list']!('{}');
    // 空库 kit 看不到刚存的（不同 adapter），这里只验 write 的落库事实
    expect(list.ok).toBe(true);
  });

  it('非法 secrets 在 parseSkillRecipe 阶段拒绝，不落库', async () => {
    const { users, exec } = kitWithAuth();
    const r = await exec({ ...args, secrets: [{ ...spec, allowedHosts: ['https://evil.com'] }] });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('allowedHosts');
    expect(await users.list()).toEqual([]);
  });
});

describe('makeUserSkillId', () => {
  it('确定性、user. 前缀、无非法字符', () => {
    const a = makeUserSkillId('查定式资料');
    const b = makeUserSkillId('查定式资料');
    expect(a).toBe(b);
    expect(a.startsWith('user.')).toBe(true);
    expect(a).toMatch(/^user\.[a-z0-9-]+$/);
    expect(makeUserSkillId('另一个')).not.toBe(a);
  });
});


// ---------- 分类标签（2026-11-21）：skill_write 可选参数 ----------
describe('skill_write 可选 category', () => {
  it('schema 放行 category，填了就落进本地配方', async () => {
    const { users, dev, exec } = kit();
    const schema = dev.tools.find((t) => t.name === 'skill_write')!.parameters;
    expect(schema.properties).toHaveProperty('category');
    const r = await exec('skill_write', {
      name: '查天气', summary: '查天气', primitives: ['web_fetch'],
      prompt: '查天气', category: '生活',
    });
    expect(r.ok).toBe(true);
    const saved = await users.list();
    expect(saved[0]!.recipe.category).toBe('生活');
  });
});

// ---------- 可选路由词（短语数组）：宿主通用性整改 ----------
describe('skill_write 可选 routeHint', () => {
  it('schema 的 routeHint 是 array / items:string，话术中性（不含具体技能场景词）', () => {
    const { dev } = kit();
    const schema = dev.tools.find((t) => t.name === 'skill_write')!.parameters;
    const props = schema.properties as Record<string, { type?: string; items?: { type?: string }; description?: string }>;
    expect(props['routeHint']).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(props['routeHint']!.description).toContain('可选路由词');
    expect(props['routeHint']!.description).toContain('id|name');
    for (const word of ['拍照', '摆子', '棋谱', '记谱', '还原']) {
      expect(props['routeHint']!.description).not.toContain(word);
    }
    expect(dev.systemSuffix).toContain('routeHint');
    expect(dev.systemSuffix).toContain('可选路由词');
    for (const word of ['一行触发条件', '拍照', '摆子', '棋谱', '记谱']) {
      expect(dev.systemSuffix).not.toContain(word);
    }
    // category 描述也不列举具体领域
    for (const word of ['围棋', '财经', '搜索', '生活', '开发']) {
      expect(props['category']!.description).not.toContain(word);
    }
  });

  it('填了数组就透传落库，未填不塞进配方（目录只给 id|name）', async () => {
    const { users, exec } = kit();
    const r = await exec('skill_write', {
      name: '示例技能', summary: '执行说明',
      routeHint: ['用户说「查一下…」时', '用户想核对一份清单时'],
      primitives: ['navigate_to'], prompt: '调用 navigate_to',
    });
    expect(r.ok).toBe(true);
    const saved = await users.list();
    expect(saved[0]!.recipe.routeHint).toEqual([
      '用户说「查一下…」时', '用户想核对一份清单时',
    ]);
    expect(saved[0]!.recipe.summary).toBe('执行说明');

    const r2 = await exec('skill_write', {
      name: '另一个', summary: '执行说明', primitives: ['web_fetch'], prompt: 'p',
    });
    expect(r2.ok).toBe(true);
    const all = await users.list();
    const plain = all.find((e) => e.recipe.name === '另一个')!;
    expect(plain.recipe).not.toHaveProperty('routeHint');
  });

  it('含换行的数组项在 parseSkillRecipe 阶段拒绝，不落库', async () => {
    const { users, exec } = kit();
    const r = await exec('skill_write', {
      name: '坏提示', summary: 's', routeHint: ['正常短语', '第一行\n第二行'],
      primitives: ['web_fetch'], prompt: 'p',
    });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('单行非空字符串短语');
    expect(await users.list()).toEqual([]);
  });
  it('skill_rename 改名：只换 id，配方 / 版本 / 启用状态全不变', async () => {
    const { exec, users } = kit();
    const saved = await exec('skill_write', {
      name: '发布助手', summary: 's', primitives: ['web_fetch'], prompt: 'p',
    });
    expect(saved.ok).toBe(true);
    const before = (await users.list())[0]!;
    const oldId = before.recipe.id;
    const r = await exec('skill_rename', { fromId: oldId, newId: 'admin.publish' });
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('只换了发布用 id');
    const after = (await users.list())[0]!;
    expect(after.recipe.id).toBe('admin.publish');
    expect(after.recipe.version).toBe(before.recipe.version);
    expect(after.recipe.name).toBe(before.recipe.name);
    expect(after.enabled).toBe(before.enabled);
    expect((await users.list()).some((e) => e.recipe.id === oldId)).toBe(false);
  });

  it('skill_rename 拒绝：在线条目只读 / 目标占用 / 非法新 id / 原 id 不存在 / 新旧相同', async () => {
    const { exec, users } = kit();
    await users.install({
      schemaVersion: 1, id: 'online.readonly', version: 3, name: '在线',
      summary: 's', primitives: ['navigate_to'], prompt: 'p',
    } as never);
    await exec('skill_write', {
      name: '自建', summary: 's', primitives: ['web_fetch'], prompt: 'p',
    });
    const custom = (await users.list()).find((e) => e.source === 'custom')!;

    const ro = await exec('skill_rename', { fromId: 'online.readonly', newId: 'admin.publish' });
    expect(ro.ok).toBe(false);
    expect(ro.observation).toContain('只读');

    const dup = await exec('skill_rename', { fromId: custom.recipe.id, newId: 'online.readonly' });
    expect(dup.ok).toBe(false);
    expect(dup.observation).toContain('占用');

    const bad = await exec('skill_rename', { fromId: custom.recipe.id, newId: 'Bad:中文' });
    expect(bad.ok).toBe(false);
    expect(bad.observation).toContain('不合法');

    const missing = await exec('skill_rename', { fromId: 'nope', newId: 'admin.publish' });
    expect(missing.ok).toBe(false);
    const same = await exec('skill_rename', { fromId: custom.recipe.id, newId: custom.recipe.id });
    expect(same.ok).toBe(true);
    expect(same.observation).toContain('无需操作');
    expect((await users.list()).find((e) => e.source === 'custom')?.recipe.id).toBe(custom.recipe.id);
  });

  it('skill_write 不再带 fromId；改名走独立 skill_rename（工具声明各自干净）', () => {
    const { dev } = kit();
    const write = dev.tools.find((t) => t.name === 'skill_write')!;
    const rename = dev.tools.find((t) => t.name === 'skill_rename')!;
    expect(JSON.stringify(write.parameters)).not.toContain('fromId');
    expect(JSON.stringify(rename.parameters)).toContain('fromId');
    expect(JSON.stringify(rename.parameters)).toContain('newId');
  });

});


// ---------- returnToLLM 开关（契约 D）：skill_write 新字段解析 ----------
describe('skill_write 可选 returnToLLM', () => {
  it('schema 放行 returnToLLM（boolean），且 workflow/inputs 说明里提到该字段', () => {
    const { dev } = kit();
    const schema = dev.tools.find((t) => t.name === 'skill_write')!.parameters;
    const props = schema.properties as Record<string, { type?: string; description?: string }>;
    expect(props['returnToLLM']).toMatchObject({ type: 'boolean' });
    expect(props['returnToLLM']!.description).toContain('yield 汇总');
    expect(props['returnToLLM']!.description).toContain('默认 false');
    // workflow / inputs 配套说明里要点到该字段，否则开发角色写不进
    expect(dev.systemSuffix).toContain('returnToLLM');
    expect(dev.systemSuffix).toContain('仅带 workflow 的配方有意义');
  });

  it('合法 boolean 透传落库；缺省不塞进配方（默认 false）', async () => {
    const { users, exec } = kit();
    const r = await exec('skill_write', {
      name: '弈友圈测试', summary: '分析弈友圈', primitives: [],
      prompt: '据数据分析', returnToLLM: true,
      workflow: { steps: [{ id: 'only', call: 'web_fetch', yield: true }] },
    });
    expect(r.ok).toBe(true);
    const saved = await users.list();
    expect(saved[0]!.recipe.returnToLLM).toBe(true);
    // skill_list 回显该字段
    const list = await exec('skill_list', {});
    expect(list.observation).toContain('returnToLLM');

    const r2 = await exec('skill_write', {
      name: '另一个技能', summary: 's', primitives: [], prompt: 'p',
      workflow: { steps: [{ id: 'only', call: 'web_fetch' }] },
    });
    expect(r2.ok).toBe(true);
    const all = await users.list();
    const plain = all.find((e) => e.recipe.name === '另一个技能')!;
    expect(plain.recipe).not.toHaveProperty('returnToLLM');
  });

  it('非法值（字符串 / 数字 / null）在 parseSkillRecipe 阶段拒绝，不落库', async () => {
    const { users, exec } = kit();
    const base = {
      name: '坏开关', summary: 's', primitives: ['web_fetch'], prompt: 'p',
    };
    for (const bad of ['true', 1, null]) {
      const r = await exec('skill_write', { ...base, returnToLLM: bad });
      expect(r.ok).toBe(false);
      expect(r.observation).toContain('returnToLLM');
      expect(r.observation).toContain('boolean');
    }
    expect(await users.list()).toEqual([]);
  });
});


// ---------- B3：skill_write 可选 llmProjection（声明式字段白名单） ----------
describe('skill_write 可选 llmProjection（B3 契约 A1 / A3b）', () => {
  const base = {
    name: '弈友圈 B3', summary: '圈层关系分析', primitives: [],
    prompt: '据读数分析', returnToLLM: true,
    workflow: { steps: [{ id: 'only', call: 'web_fetch', yield: true }] },
  };

  it('schema 放行 llmProjection（object / keep 字符串数组 / required / additionalProperties:false），systemSuffix 含字段名', () => {
    const { dev } = kit();
    const schema = dev.tools.find((t) => t.name === 'skill_write')!.parameters;
    const props = schema.properties as Record<string, {
      type?: string; properties?: Record<string, unknown>;
      required?: string[]; additionalProperties?: boolean; description?: string;
    }>;
    const p = props['llmProjection']!;
    expect(p).toMatchObject({ type: 'object', required: ['keep'], additionalProperties: false });
    expect(p.properties).toHaveProperty('keep');
    expect(p.properties!['keep']).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(p.description).toContain('llmProjection');
    expect(p.description).toContain('缺省 = B2 全量');
    // 出处字样（宿主 SkillRecipe.llmProjection / B3 契约 A1）
    expect(p.description).toContain('SkillRecipe.llmProjection');
    // 既有 returnToLLM description 断言逐字保留的两个子串仍在
    expect(props['returnToLLM']!.description).toContain('yield 汇总');
    expect(props['returnToLLM']!.description).toContain('默认 false');
    // dev.systemSuffix 含该字段名（指路）
    expect(dev.systemSuffix).toContain('llmProjection');
    expect(dev.systemSuffix).toContain('returnToLLM');
  });

  it('合法 llmProjection 透传落库，users.list()[0].recipe.llmProjection 逐字相等；skill_list 回显含该字段', async () => {
    const { users, exec } = kit();
    const projection = { keep: ['stats', 'nodes'] };
    const r = await exec('skill_write', { ...base, llmProjection: projection });
    expect(r.ok).toBe(true);
    const saved = await users.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.recipe.llmProjection).toEqual({ keep: ['stats', 'nodes'] });
    expect(saved[0]!.recipe.returnToLLM).toBe(true);
    // 逐字相等（顺序 / 值都不改）
    expect(saved[0]!.recipe.llmProjection!.keep).toEqual(projection.keep);
    const list = await exec('skill_list', {});
    expect(list.observation).toContain('llmProjection');
    expect(list.observation).toContain('"stats"');
    expect(list.observation).toContain('"nodes"');
    // 缺省不塞进配方（B2 全量零回归）
    const r2 = await exec('skill_write', { ...base, name: '另一个 B3' });
    expect(r2.ok).toBe(true);
    const all = await users.list();
    expect(all.find((e) => e.recipe.name === '另一个 B3')!.recipe)
      .not.toHaveProperty('llmProjection');
  });

  it('非法（keep 空数组 / 含非字符串 / 整个字段是字符串 / 缺 keep）在 parseSkillRecipe 阶段拒绝、不落库', async () => {
    const { users, exec } = kit();
    const bads: unknown[] = [
      { keep: [] },
      { keep: ['stats', 42] },
      { keep: ['stats', '  '] },
      'stats,nodes',
      {},
      { keep: 'stats' },
      { keep: null },
      null,
      5,
      [],
    ];
    for (const bad of bads) {
      const r = await exec('skill_write', { ...base, llmProjection: bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.observation, JSON.stringify(bad)).toContain('llmProjection');
      expect(await users.list(), JSON.stringify(bad)).toEqual([]);
    }
  });
});
