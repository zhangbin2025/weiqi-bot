/**
 * 技能配方编排：本地库是唯一生效来源；在线源只供浏览 / 安装
 * @module services/skill-catalog/SkillCatalogService
 *
 * 边界（安装制，与插件同套使用规则）：
 * - loadSkills() 只取本地库里 enabled 的条目，绝不联网、不叠加内置常量、不自动生效在线配方；
 * - 在线技能要经面板「安装」写进本地库，才会出现在「我的技能」并被 LLM 调用；
 * - 在线源是单源模型（默认 weiqi-assets，可改任意 https URL，见 SkillCatalogSources）；
 * - 「有更新」判据 = 远端与本地同 id 的 version 不等（沿用插件「内容不等即更新」口径，
 *   不是阈值 / 打分）；更新按同 id 覆盖、保留用户已设的启停状态；
 * - 引用了宿主注册表里没有的原语的配方只展示、不可安装；
 * - 不缓存、不重试、不设超时（沿用浏览器 fetch 默认）；不执行任何远程代码；
 * - browse() / install() 失败都转成中文结果，绝不把异常抛到对话 / 面板炸弹框。
 */

import type { SkillPrimitive, SkillRecipe } from '@application/skill/SkillTypes';
import { UserSkillStore } from '@application/skill/dev/UserSkillStore';
import { parseSkillRecipe } from '@application/skill/SkillRecipe';
import { SkillCatalogClient } from './SkillCatalogClient';
import {
  SkillCatalogSources, DEFAULT_SKILL_REGISTRY_URL, type SkillSource,
} from './SkillCatalogSources';

export interface SkillCatalogDeps {
  /** 可注入的 fetch（测试用）；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
  /** 可注入的在线源 URL（测试用，优先级高于 sources 当前源） */
  onlineUrl?: string;
  /** 本库技能库（与面板 / 开发工具共用同一实例） */
  users?: UserSkillStore;
  /** 在线源管理（与面板共用同一实例） */
  sources?: SkillCatalogSources;
  /** 宿主原语注册表；用于「缺原语 → 不可安装」判定 */
  primitives?: ReadonlyMap<string, SkillPrimitive>;
}

/** 在线条目相对本地库的状态 */
export type SkillInstallState = 'new' | 'installed' | 'update' | 'unavailable';

/** 在线标签里的一条配方 + 它的本地状态 */
export interface SkillBrowseItem {
  recipe: SkillRecipe;
  state: SkillInstallState;
  /** unavailable 时给出原因（缺原语 / 单条配方不合法）；整份清单结构不合法则由 browse 的 error 承载 */
  reason?: string;
}

/** 「在线技能」标签的只读浏览结果 */
export interface SkillCatalogBrowseResult {
  source: SkillSource;
  /** 当前在线源里的配方及安装状态；源不可达时为空 */
  items: SkillBrowseItem[];
  /** 源不可达 / 格式不合法时的一行中文原因，供 UI 显示 */
  error?: string;
}

/** install() 的回执 */
export interface SkillInstallResult {
  ok: boolean;
  action: 'installed' | 'updated' | 'rejected';
  message: string;
}

export class SkillCatalogService {
  private readonly client: SkillCatalogClient;
  private readonly onlineUrlOverride: string | undefined;
  private readonly users: UserSkillStore;
  private readonly sources: SkillCatalogSources;
  private readonly primitives: ReadonlyMap<string, SkillPrimitive>;

  constructor(deps: SkillCatalogDeps = {}) {
    // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined
    const clientDeps: { fetchImpl?: typeof fetch } = {};
    if (deps.fetchImpl !== undefined) clientDeps.fetchImpl = deps.fetchImpl;
    this.client = new SkillCatalogClient(clientDeps);
    this.onlineUrlOverride = deps.onlineUrl;
    this.users = deps.users ?? new UserSkillStore();
    this.sources = deps.sources ?? new SkillCatalogSources();
    this.primitives = deps.primitives ?? new Map();
  }

  /**
   * 本轮对话能用的技能：本地库里已启用的条目，仅此一层。
   * 在线源可达与否、内置常量是否存在，对对话完全无影响。
   * 本地库读取失败只当空库（不把异常抛到对话）。
   */
  async loadSkills(): Promise<SkillRecipe[]> {
    try {
      const entries = await this.users.list();
      return entries.filter((e) => e.enabled).map((e) => e.recipe);
    } catch {
      return [];
    }
  }

  /** 当前生效的在线源（面板显示 / 恢复默认按钮） */
  async currentSource(): Promise<SkillSource> {
    return this.sources.current();
  }

  /** 替换当前在线源；非法地址抛错，由 UI 转成一行提示 */
  async setSource(rawUrl: string): Promise<string> {
    return this.sources.setCurrent(rawUrl);
  }

  /** 恢复官方默认源 */
  async resetSource(): Promise<void> {
    await this.sources.reset();
  }

  /** 面板「在线技能」标签：列出当前源配方 + 逐条对照本地库的安装状态 */
  async browse(): Promise<SkillCatalogBrowseResult> {
    const source = await this.sources.current();
    const url = this.onlineUrlOverride ?? source.url;
    let remote: SkillRecipe[];
    try {
      remote = await this.client.fetchRegistry(url);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { source, items: [], ...(reason ? { error: reason } : {}) };
    }
    const locals = await this.localEntries();
    const byId = new Map(locals.map((e) => [e.recipe.id, e]));
    const items = remote.map((recipe) => this.stateOf(recipe, byId));
    return { source, items };
  }

  /**
   * 安装 / 更新一条在线配方：结构校验 + 原语存在性校验 → 写本地库。
   * 与 browse() 用同一份判定，绝不绕过「缺原语不可装」。
   */
  async install(recipe: SkillRecipe): Promise<SkillInstallResult> {
    const parsed = parseSkillRecipe(recipe);
    if (!parsed.ok) {
      return { ok: false, action: 'rejected', message: `配方不合法：${parsed.reason}` };
    }
    const unknown = parsed.skill.primitives.filter((n) => !this.primitives.has(n));
    if (unknown.length > 0) {
      return {
        ok: false, action: 'rejected',
        message: `宿主没有这些原语：${unknown.join('、')}，无法安装。`,
      };
    }
    const locals = await this.localEntries();
    const existing = locals.find((e) => e.recipe.id === parsed.skill.id);
    try {
      await this.users.install(parsed.skill);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, action: 'rejected', message: reason };
    }
    return existing === undefined
      ? { ok: true, action: 'installed', message: '已安装到「我的技能」，即刻生效。' }
      : { ok: true, action: 'updated', message: '已更新（保留启停状态）。' };
  }

  /** 本库技能库（面板 / 开发工具共用同一实例） */
  userStore(): UserSkillStore {
    return this.users;
  }

  private async localEntries() {
    try {
      return await this.users.list();
    } catch {
      return [];
    }
  }

  private stateOf(
    recipe: SkillRecipe,
    byId: ReadonlyMap<string, { recipe: SkillRecipe }>,
  ): SkillBrowseItem {
    const parsed = parseSkillRecipe(recipe);
    if (!parsed.ok) {
      return { recipe, state: 'unavailable', reason: `配方不合法：${parsed.reason}` };
    }
    const unknown = parsed.skill.primitives.filter((n) => !this.primitives.has(n));
    if (unknown.length > 0) {
      return { recipe, state: 'unavailable', reason: `缺原语：${unknown.join('、')}` };
    }
    const local = byId.get(parsed.skill.id);
    if (local === undefined) return { recipe: parsed.skill, state: 'new' };
    return {
      recipe: parsed.skill,
      state: local.recipe.version === parsed.skill.version ? 'installed' : 'update',
    };
  }
}

/** 默认构造：官方默认源 + 默认本地库 */
export function createDefaultSkillCatalog(deps: SkillCatalogDeps = {}): SkillCatalogService {
  return new SkillCatalogService(deps);
}

export { DEFAULT_SKILL_REGISTRY_URL };
