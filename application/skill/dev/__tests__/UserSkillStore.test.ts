/**
 * UserSkillStore：本机技能配方库（自建 + 在线安装）
 * 用一个内存版的 LocalStorageAdapter 桩（只需 initialize/read/write/delete），
 * 绝不触碰真实 localStorage。
 */

import { describe, it, expect } from 'vitest';
import { UserSkillStore } from '../UserSkillStore';
import type { SkillRecipe } from '@application/skill/SkillTypes';

interface MemAdapter {
  initialize(): Promise<void>;
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, data: T): Promise<void>;
  delete(key: string): Promise<void>;
}

function mem(): MemAdapter & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    initialize: async () => {},
    read: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    write: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
  };
}

function recipe(overrides: Partial<SkillRecipe> = {}): SkillRecipe {
  return {
    schemaVersion: 1,
    id: 'user.demo',
    version: 1,
    name: '示例技能',
    summary: '示例摘要',
    triggers: ['示例'],
    primitives: ['web_fetch'],
    prompt: '用 web_fetch 查资料。',
    ...overrides,
  };
}

function store() {
  const m = mem();
  return { store: new UserSkillStore({ localStorage: m as never }), m };
}

describe('UserSkillStore — 自建技能', () => {
  it('空库返回 []; 存储不可用（initialize 抛错）也静默返回 []', async () => {
    const { store: s } = store();
    expect(await s.list()).toEqual([]);
    const broken = new UserSkillStore({
      localStorage: { initialize: async () => { throw new Error('no storage'); } } as never,
    });
    expect(await broken.list()).toEqual([]);
  });

  it('save 新建：补 version=1、默认启用、来源 custom', async () => {
    const { store: s } = store();
    const entry = await s.save(recipe({ version: 99 })); // 模型给的版本号被宿主覆盖
    expect(entry.recipe.version).toBe(1);
    expect(entry.enabled).toBe(true);
    expect(entry.source).toBe('custom');
    expect(await s.list()).toHaveLength(1);
  });

  it('save 同 id 修订：版本递增、保留启用状态、整份覆盖', async () => {
    const { store: s } = store();
    await s.save(recipe());
    await s.setEnabled('user.demo', false);
    const second = await s.save(recipe({ name: '改名', triggers: ['新触发'] }));
    expect(second.recipe.version).toBe(2);
    expect(second.recipe.name).toBe('改名');
    expect(second.enabled).toBe(false); // 修订不擅自重新启用
    expect(await s.list()).toHaveLength(1);
  });

  it('setEnabled / remove 生效', async () => {
    const { store: s } = store();
    await s.save(recipe());
    await s.setEnabled('user.demo', false);
    expect((await s.list())[0]?.enabled).toBe(false);
    await s.setEnabled('user.demo', true);
    expect((await s.list())[0]?.enabled).toBe(true);
    await s.remove('user.demo');
    expect(await s.list()).toEqual([]);
  });
});

describe('UserSkillStore — 在线安装', () => {
  it('install：id/version 原样保留、默认启用、来源 online', async () => {
    const { store: s } = store();
    const entry = await s.install(recipe({ id: 'puzzle.tsumego', version: 4 }));
    expect(entry.recipe.id).toBe('puzzle.tsumego');
    expect(entry.recipe.version).toBe(4); // 远端版本，宿主不递增
    expect(entry.enabled).toBe(true);
    expect(entry.source).toBe('online');
  });

  it('install 同 id 更新：按远端版本覆盖，保留用户已设的停用状态', async () => {
    const { store: s } = store();
    await s.install(recipe({ id: 'puzzle.tsumego', version: 4, summary: '旧' }));
    await s.setEnabled('puzzle.tsumego', false);
    const updated = await s.install(recipe({ id: 'puzzle.tsumego', version: 5, summary: '新' }));
    expect(updated.recipe.version).toBe(5);
    expect(updated.recipe.summary).toBe('新');
    expect(updated.enabled).toBe(false);
    expect(await s.list()).toHaveLength(1);
  });

  it('在线安装条目只读：skill_write 走 save() 改写时被拒绝', async () => {
    const { store: s } = store();
    await s.install(recipe({ id: 'puzzle.tsumego', version: 4 }));
    await expect(s.save(recipe({ id: 'puzzle.tsumego', name: '想改' })))
      .rejects.toThrow('只读');
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.recipe.name).toBe('示例技能'); // 原配方没被改
    expect(list[0]?.source).toBe('online');
  });

  it('自建与在线安装两类条目共存', async () => {
    const { store: s } = store();
    await s.install(recipe({ id: 'puzzle.tsumego', version: 4 }));
    await s.save(recipe({ id: 'user.mine' }));
    const list = await s.list();
    expect(list.map((e) => e.source).sort()).toEqual(['custom', 'online']);
    expect(list.map((e) => e.recipe.id).sort()).toEqual(['puzzle.tsumego', 'user.mine']);
  });
});

describe('UserSkillStore — 读取健壮性', () => {
  it('脏数据：坏条目跳过、非 user. 前缀的在线条目保留、非数组整库当空', async () => {
    const { store: s, m } = store();
    m.data.set('skill-user:entries', [
      { recipe: recipe(), enabled: true, source: 'custom', updatedAt: 1 },
      { recipe: { nope: true }, enabled: true },                       // 坏配方
      { recipe: recipe({ id: 'puzzle.tsumego' }), source: 'online' },  // 在线安装条目
      'garbage',                                                      // 非对象
    ]);
    const list = await s.list();
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.recipe.id).sort()).toEqual(['puzzle.tsumego', 'user.demo']);
    expect(list.find((e) => e.recipe.id === 'puzzle.tsumego')?.source).toBe('online');
    m.data.set('skill-user:entries', { not: 'array' });
    expect(await s.list()).toEqual([]);
  });

  it('缺省 source 字段的条目按 custom 读（同一库里两类数据自然共存）', async () => {
    const { store: s, m } = store();
    m.data.set('skill-user:entries', [{ recipe: recipe(), enabled: true, updatedAt: 1 }]);
    expect((await s.list())[0]?.source).toBe('custom');
  });

  it('写入失败（存储抛错）时 save / install / setEnabled / remove 抛错，不谎报成功', async () => {
    const broken = new UserSkillStore({
      localStorage: {
        initialize: async () => {}, read: async () => null,
        write: async () => { throw new Error('quota'); }, delete: async () => {},
      } as never,
    });
    await expect(broken.save(recipe())).rejects.toThrow('未保存');
    await expect(broken.install(recipe())).rejects.toThrow('未安装');
    await expect(broken.setEnabled('user.demo', false)).rejects.toThrow('未生效');
    await expect(broken.remove('user.demo')).rejects.toThrow('未生效');
  });
});
