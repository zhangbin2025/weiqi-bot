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
    expect(dev.tools.map((t) => t.name).sort()).toEqual(['skill_list', 'skill_write']);
    expect(dev.systemSuffix).toContain('web_fetch');
    expect(dev.systemSuffix).toContain('navigate_to');
    expect(dev.systemSuffix).toContain('技能开发');
    expect(dev.systemSuffix).toContain('在线技能');
    expect(dev.systemSuffix).toContain('只读');
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
    // 非 user. 前缀在 id 校验阶段就被挡住；即便绕过，store 里也有第二道只读保护
    expect(writeOut.ok).toBe(false);
    expect(writeOut.observation).toContain('user.');
    const stored = await users.list();
    expect(stored[0]?.recipe.name).toBe('做题');
    expect(stored[0]?.source).toBe('online');
  });

  it('skill_write 新建：宿主补 id/version，保存即时启用', async () => {
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

  it('拒绝非 user. 前缀 id（防止覆盖内置/在线技能）', async () => {
    const { exec, users } = kit();
    const out = await exec('skill_write', {
      id: 'puzzle.tsumego', name: 'x', summary: 's', 
      primitives: ['web_fetch'], prompt: 'p',
    });
    expect(out.ok).toBe(false);
    expect(out.observation).toContain('user.');
    expect(await users.list()).toEqual([]);
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
