/**
 * 本机技能配方库（浏览器本地，零网络）
 * @module application/skill/dev/UserSkillStore
 *
 * 边界：
 * - 只存 SkillRecipe 纯声明 JSON + enabled 开关 + 来源标记，绝不存可执行代码；
 * - 存储用 LocalStorageAdapter('weiqi-bot')，与插件源配置同一命名空间；
 * - 读时逐条过 parseSkillRecipe：脏数据 / 半损坏只跳过坏条目，不整库清空；
 * - 本地库是技能生效的唯一来源：对话不读内置常量、不自动叠加在线源；
 * - 任何存储异常静默降级（隐私模式 / 配额满不抛穿到对话页）。
 *
 * 条目两类，用 source 区分：
 * - custom：技能开发角色 skill_write 造的，id 一律 `user.` 前缀，version 由宿主递增；
 * - online：面板「在线技能」点安装落下来的，id / version 原样取远端，只读（模型不可改写）。
 *
 * 启停口径（2026-11-25）：
 * - 散文技能 / 在线安装：纯声明、不执行代码，保存即启用（既有行为不变）；
 * - 带 workflow 声明的自建技能：**保存/修订一律未启用**，只有 dev 角色
 *   `run_workflow(debug:true)` 整条 DAG 跑通后由宿主翻转启用。
 *   修订会重置这道闸门，避免「旧版验收过、新版没验就自动生效」。
 */

import { LocalStorageAdapter } from '@infrastructure/storage/adapters/web/LocalStorageAdapter';
import { parseSkillRecipe } from '@application/skill/SkillRecipe';
import type { SkillRecipe } from '@application/skill/SkillTypes';

const STORAGE_KEY = 'skill-user:entries';

export type UserSkillSource = 'custom' | 'online';

export interface UserSkillEntry {
  recipe: SkillRecipe;
  enabled: boolean;
  /** 自建 / 在线安装；在线条目只读，不允许 skill_write 改写 */
  source: UserSkillSource;
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

  /** 全部本地条目（含停用）。存储不可用 / 数据损坏 → 空数组，绝不抛穿。 */
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
      if (!parsed.ok) continue; // 坏条目跳过，其余保留
      out.push({
        recipe: parsed.skill,
        enabled: item['enabled'] !== false, // 缺省视为启用
        source: item['source'] === 'online' ? 'online' : 'custom',
        updatedAt: typeof item['updatedAt'] === 'number' ? item['updatedAt'] : 0,
      });
    }
    return out;
  }

  /**
   * 新建 / 修订自建技能（按 id upsert）。version 由宿主按同 id 现有版本 +1 维护：
   * 模型永远不写版本号，避免它编造或倒退版本。
   * 在线安装的条目是只读的：即便模型显式填了同 id，也拒绝改写，
   * 更新/删除只能走面板（一次明确的人工动作）。
   * 写入失败（隐私模式 / 配额满）抛错，由调用方如实回执；不谎报「已保存」。
   */
  async save(recipe: SkillRecipe): Promise<UserSkillEntry> {
    const entries = await this.list();
    const existing = entries.find((e) => e.recipe.id === recipe.id);
    if (existing?.source === 'online') {
      throw new Error('这条是在线安装的技能，属于只读配方；请到「🧠 技能」面板更新或删除，不能由技能开发工具改写。');
    }
    const next: UserSkillEntry = {
      recipe: { ...recipe, version: (existing?.recipe.version ?? 0) + 1 },
      // workflow 配方走「调试通过才启用」闸门：新建默认停用、修订重置停用
      // （不沿用旧 enabled，否则改一版没验收就自动生效）。散文技能仍即时启用。
      enabled: recipe.workflow !== undefined ? false : (existing?.enabled ?? true),
      source: 'custom',
      updatedAt: Date.now(),
    };
    const merged = entries.filter((e) => e.recipe.id !== recipe.id);
    merged.push(next);
    const ok = await this.write(merged);
    if (!ok) throw new Error('浏览器本地存储不可用，技能未保存（隐私模式或配额已满）');
    return next;
  }

  /**
   * 安装 / 更新在线配方（按 id upsert）。id 与 version 原样取远端，不递增：
   * 版本号由配方发布方维护，宿主无权改动；「有更新」判据就是远端与本地 version 不等。
   * 更新保留用户已设的启停状态（沿用现有 enabled），新装默认启用。
   */
  async install(recipe: SkillRecipe): Promise<UserSkillEntry> {
    const entries = await this.list();
    const existing = entries.find((e) => e.recipe.id === recipe.id);
    const next: UserSkillEntry = {
      recipe: { ...recipe },
      enabled: existing?.enabled ?? true,
      source: 'online',
      updatedAt: Date.now(),
    };
    const merged = entries.filter((e) => e.recipe.id !== recipe.id);
    merged.push(next);
    const ok = await this.write(merged);
    if (!ok) throw new Error('浏览器本地存储不可用，技能未安装（隐私模式或配额已满）');
    return next;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const entries = await this.list();
    const ok = await this.write(entries.map((e) => (e.recipe.id === id ? { ...e, enabled } : e)));
    if (!ok) throw new Error('浏览器本地存储不可用，操作未生效');
  }

  /**
   * 改一条**自建**技能的 id（纯声明配方，无外部引用，改 id 即换键值）。
   * - 在线安装条目只读：远端配方 id 是资源仓的事实，改名会破坏「有更新」判据；
   * - 目标 id 已被占用（含另一条在线条目）一律拒绝，不静默覆盖；
   * - enabled / source / updatedAt 原样保留，version 不重置（配方内容没变，
   *   发布方只关心 id 变干净了；版本号单调性由 save/install 各自维护）。
   */
  async renameId(oldId: string, newId: string): Promise<UserSkillEntry> {
    const entries = await this.list();
    const existing = entries.find((e) => e.recipe.id === oldId);
    if (existing === undefined) throw new Error(`本地技能 ${oldId} 不存在；先用 skill_list 确认 id`);
    if (existing.source === 'online') {
      throw new Error('这条是在线安装的技能，属于只读配方；id 由发布方维护，不能改名。');
    }
    if (oldId === newId) return existing;
    if (entries.some((e) => e.recipe.id === newId)) {
      throw new Error(`目标 id ${newId} 已被另一条本地技能占用；换一个不重名的 id`);
    }
    const next: UserSkillEntry = {
      ...existing,
      recipe: { ...existing.recipe, id: newId },
      // 面板排序只认这个时刻；来源是 Date.now()，不是任何阈值。
      updatedAt: Date.now(),
    };
    const merged = entries.map((e) => (e.recipe.id === oldId ? next : e));
    const ok = await this.write(merged);
    if (!ok) throw new Error('浏览器本地存储不可用，改名未生效');
    return next;
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
