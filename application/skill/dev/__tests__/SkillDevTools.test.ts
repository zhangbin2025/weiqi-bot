/**
 * SkillDevTools：技能开发角色的两个工具（skill_list / skill_write）
 * 只测「模型提交声明 → 宿主校验 → 落库」这条链路，不打网络、不碰真实 localStorage。
 */

import { describe, it, expect } from 'vitest';
import { createSkillDevKit, makeUserSkillId } from '../SkillDevTools';
import { UserSkillStore } from '../UserSkillStore';
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
  });

  it('skill_list 空库给出明确提示', async () => {
    const { exec } = kit();
    const out = await exec('skill_list', {});
    expect(out.ok).toBe(true);
    expect(out.observation).toContain('没有任何');
  });

  it('skill_write 新建：宿主补 id/version，保存即时启用', async () => {
    const { exec, users } = kit();
    const out = await exec('skill_write', {
      name: '查定式资料',
      summary: '用户问定式时查资料',
      triggers: ['定式', '定式查询'],
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
      name: '查定式', summary: 's', triggers: ['定式'], primitives: ['web_fetch'], prompt: 'p',
    });
    expect(first.ok).toBe(true);
    const id = (await users.list())[0]!.recipe.id;
    const second = await exec('skill_write', {
      id, name: '查定式（改）', summary: 's2', triggers: ['定式2'],
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
      name: '乱来', summary: 's', triggers: ['x'],
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
      id: 'puzzle.tsumego', name: 'x', summary: 's', triggers: ['x'],
      primitives: ['web_fetch'], prompt: 'p',
    });
    expect(out.ok).toBe(false);
    expect(out.observation).toContain('user.');
    expect(await users.list()).toEqual([]);
  });

  it('结构不合法（空 triggers / 缺字段 / 非法 JSON）一律失败且回中文原因', async () => {
    const { exec, users } = kit();
    const bad = await exec('skill_write', {
      name: 'x', summary: 's', triggers: [], primitives: ['web_fetch'], prompt: 'p',
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
