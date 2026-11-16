/**
 * 用户自建技能配方库（浏览器本地，零网络）
 * @module application/skill/dev/UserSkillStore
 *
 * 边界：
 * - 只存 SkillRecipe 纯声明 JSON + enabled 开关，绝不存可执行代码；
 * - 存储用 LocalStorageAdapter('weiqi-bot')，与插件源配置同一命名空间；
 * - 读时逐条过 parseSkillRecipe：脏数据 / 半损坏只跳过坏条目，不整库清空；
 * - 只认 `user.` 前缀的 id（自建技能），避免历史上误写入的内置/在线配方混进来；
 * - 任何存储异常静默降级（隐私模式 / 配额满不抛穿到对话页）。
 *
 * 新建即启用：技能是纯声明、不执行代码，不需要插件那道「默认停用 → 人工启用」
 * 闸门；用户要的是「写完就在同一会话说一句触发词当场验收」。
 */

import { LocalStorageAdapter } from '@infrastructure/storage/adapters/web/LocalStorageAdapter';
import { parseSkillRecipe } from '@application/skill/SkillRecipe';
import type { SkillRecipe } from '@application/skill/SkillTypes';

const STORAGE_KEY = 'skill-user:entries';

export interface UserSkillEntry {
  recipe: SkillRecipe;
  enabled: boolean;
  /** 最后修改时刻（ms），仅用于面板展示；来源是 Date.now()，不是阈值 */
  updatedAt: number;
}

export interface UserSkillStoreDeps {
  /** 可注入的存储（测试用）；默认 LocalStorageAdapter('weiqi-bot') */
  localStorage?: LocalStorageAdapter;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class UserSkillStore {
  private readonly store: LocalStorageAdapter;

  constructor(deps: UserSkillStoreDeps = {}) {
    this.store = deps.localStorage ?? new LocalStorageAdapter('weiqi-bot');
  }

  /** 全部自建条目（含停用）。存储不可用 / 数据损坏 → 空数组，绝不抛穿。 */
  async list(): Promise<UserSkillEntry[]> {
    let raw: unknown;
    try {
      await this.store.initialize();
      raw = await this.store.read<unknown>(STORAGE_KEY);
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    const items: readonly unknown[] = raw;
    const out: UserSkillEntry[] = [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const parsed = parseSkillRecipe(item['recipe']);
      if (!parsed.ok) continue;                          // 坏条目跳过，其余保留
      if (!parsed.skill.id.startsWith('user.')) continue; // 只认自建前缀
      out.push({
        recipe: parsed.skill,
        enabled: item['enabled'] !== false,               // 缺省视为启用
        updatedAt: typeof item['updatedAt'] === 'number' ? item['updatedAt'] : 0,
      });
    }
    return out;
  }

  /**
   * 新建 / 修订（按 id upsert）。version 由宿主按同 id 现有版本 +1 维护：
   * 模型永远不写版本号，避免它编造或倒退版本。
   * 写入失败（隐私模式 / 配额满）抛错，由调用方如实回执；不谎报「已保存」。
   */
  async save(recipe: SkillRecipe): Promise<UserSkillEntry> {
    const entries = await this.list();
    const existing = entries.find((e) => e.recipe.id === recipe.id);
    const next: UserSkillEntry = {
      recipe: { ...recipe, version: (existing?.recipe.version ?? 0) + 1 },
      enabled: existing?.enabled ?? true,
      updatedAt: Date.now(),
    };
    const merged = entries.filter((e) => e.recipe.id !== recipe.id);
    merged.push(next);
    const ok = await this.write(merged);
    if (!ok) throw new Error('浏览器本地存储不可用，技能未保存（隐私模式或配额已满）');
    return next;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const entries = await this.list();
    const ok = await this.write(entries.map((e) => (e.recipe.id === id ? { ...e, enabled } : e)));
    if (!ok) throw new Error('浏览器本地存储不可用，操作未生效');
  }

  async remove(id: string): Promise<void> {
    const entries = await this.list();
    const ok = await this.write(entries.filter((e) => e.recipe.id !== id));
    if (!ok) throw new Error('浏览器本地存储不可用，删除未生效');
  }

  /** @returns 是否真的写入成功；存储不可用返回 false（不抛穿到对话页） */
  private async write(entries: UserSkillEntry[]): Promise<boolean> {
    try {
      await this.store.initialize();
      await this.store.write(STORAGE_KEY, entries);
      return true;
    } catch {
      return false;
    }
  }
}
