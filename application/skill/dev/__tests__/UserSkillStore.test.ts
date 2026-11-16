/**
 * UserSkillStore：本地自建技能配方库
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

describe('UserSkillStore', () => {
  it('空库返回 []; 存储不可用（initialize 抛错）也静默返回 []', async () => {
    const { store: s } = store();
    expect(await s.list()).toEqual([]);
    const broken = new UserSkillStore({
      localStorage: { initialize: async () => { throw new Error('no storage'); } } as never,
    });
    expect(await broken.list()).toEqual([]);
  });

  it('save 新建：补 version=1、默认启用、只保留 user. 前缀', async () => {
    const { store: s } = store();
    const entry = await s.save(recipe({ version: 99 })); // 模型给的版本号被宿主覆盖
    expect(entry.recipe.version).toBe(1);
    expect(entry.enabled).toBe(true);
    expect(entry.recipe.id).toBe('user.demo');
    expect((await s.list())).toHaveLength(1);
  });

  it('save 同 id 修订：版本递增、保留启用状态、整份覆盖', async () => {
    const { store: s } = store();
    await s.save(recipe());
    await s.setEnabled('user.demo', false);
    const second = await s.save(recipe({ name: '改名', triggers: ['新触发'] }));
    expect(second.recipe.version).toBe(2);
    expect(second.recipe.name).toBe('改名');
    expect(second.enabled).toBe(false); // 修订不擅自重新启用
    expect((await s.list())).toHaveLength(1);
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

  it('脏数据：坏条目跳过、非 user. 前缀跳过、非数组整库当空', async () => {
    const { store: s, m } = store();
    m.data.set('skill-user:entries', [
      { recipe: recipe(), enabled: true, updatedAt: 1 },
      { recipe: { nope: true }, enabled: true },               // 坏配方
      { recipe: recipe({ id: 'event.import-pairing-image' }) }, // 非自建前缀
      'garbage',                                              // 非对象
    ]);
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.recipe.id).toBe('user.demo');
    m.data.set('skill-user:entries', { not: 'array' });
    expect(await s.list()).toEqual([]);
  });

  it('写入失败（存储抛错）时 save / setEnabled / remove 抛错，不谎报成功', async () => {
    const broken = new UserSkillStore({
      localStorage: {
        initialize: async () => {}, read: async () => null,
        write: async () => { throw new Error('quota'); }, delete: async () => {},
      } as never,
    });
    await expect(broken.save(recipe())).rejects.toThrow('未保存');
    await expect(broken.setEnabled('user.demo', false)).rejects.toThrow('未生效');
    await expect(broken.remove('user.demo')).rejects.toThrow('未生效');
  });
});
