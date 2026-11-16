/**
 * 技能配方编排：内置兜底 + 在线叠加 + 本地自建（三层，只合并纯声明 JSON 配方）
 * @module services/skill-catalog/SkillCatalogService
 *
 * 边界（契约 §5 / §7.5）：
 * - 以 BUILTIN_SKILLS 为基线（零网络、永远可用），再叠加当前在线源，再叠加本地自建；
 * - 在线源是单源模型（默认 weiqi-assets，可改任意 https URL，见 SkillCatalogSources）；
 * - 三层按 id 合并：内置 → 在线（version >= 才覆盖）→ 本地自建（用户自己的优先）；
 * - 任一层取用失败静默降级，绝不把异常抛到对话 / 面板；不执行任何远程代码；
 * - 不缓存、不重试、不设超时（沿用浏览器 fetch 默认）；不设阈值、不打分、不调用模型。
 *
 * 面板用 browse() 单独取「当前在线源里有哪些配方」（只读展示），与 loadSkills 的
 * 静默降级不同：面板要给人看，源不可达时返回中文 reason 供 UI 显示。
 */

import { BUILTIN_SKILLS } from '@application/skill/BuiltinSkills';
import type { SkillRecipe } from '@application/skill/SkillTypes';
import { UserSkillStore } from '@application/skill/dev/UserSkillStore';
import { SkillCatalogClient } from './SkillCatalogClient';
import {
  SkillCatalogSources, DEFAULT_SKILL_REGISTRY_URL, type SkillSource,
} from './SkillCatalogSources';

export interface SkillCatalogDeps {
  /** 可注入的 fetch（测试用）；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
  /** 可注入的在线源 URL（测试用，优先级高于 sources 当前源） */
  onlineUrl?: string;
  /** 用户自建技能库（与面板 / 开发工具共用同一实例） */
  users?: UserSkillStore;
  /** 在线源管理（与面板共用同一实例） */
  sources?: SkillCatalogSources;
}

/** 「在线技能」标签的只读浏览结果 */
export interface SkillCatalogBrowseResult {
  source: SkillSource;
  /** 当前在线源里的配方（未合并内置）；源不可达时为空 */
  skills: SkillRecipe[];
  /** 源不可达 / 格式不合法时的一行中文原因，供 UI 显示 */
  error?: string;
}

export class SkillCatalogService {
  private readonly client: SkillCatalogClient;
  private readonly onlineUrlOverride: string | undefined;
  private readonly users: UserSkillStore;
  private readonly sources: SkillCatalogSources;

  constructor(deps: SkillCatalogDeps = {}) {
    // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined
    const clientDeps: { fetchImpl?: typeof fetch } = {};
    if (deps.fetchImpl !== undefined) clientDeps.fetchImpl = deps.fetchImpl;
    this.client = new SkillCatalogClient(clientDeps);
    this.onlineUrlOverride = deps.onlineUrl;
    this.users = deps.users ?? new UserSkillStore();
    this.sources = deps.sources ?? new SkillCatalogSources();
  }

  /**
   * 每轮重新取一次在线源 + 本地自建，合并三层。
   * 在线失败 / 格式错 / URL 不合法一律静默回落内置；本地库读取失败也只跳过该层。
   */
  async loadSkills(): Promise<SkillRecipe[]> {
    const online = await this.loadOnline();
    let user: SkillRecipe[] = [];
    try {
      const userEntries = await this.users.list();
      user = userEntries.filter((e) => e.enabled).map((e) => e.recipe);
    } catch {
      // 本地库读取失败只跳过该层：内置 + 在线照常工作，绝不把异常抛到对话
      user = [];
    }
    return mergeLayers(online, user);
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

  /** 面板「在线技能」标签：只读列出当前源里的配方，源不可达时带中文原因 */
  async browse(): Promise<SkillCatalogBrowseResult> {
    const source = await this.sources.current();
    const url = this.onlineUrlOverride ?? source.url;
    try {
      const skills = await this.client.fetchRegistry(url);
      return { source, skills };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { source, skills: [], ...(reason ? { error: reason } : {}) };
    }
  }

  /** 用户自建技能库（面板 / 开发工具共用同一实例） */
  userStore(): UserSkillStore {
    return this.users;
  }

  private async loadOnline(): Promise<SkillRecipe[]> {
    const url = this.onlineUrlOverride ?? (await this.sources.current()).url;
    try {
      return await this.client.fetchRegistry(url);
    } catch {
      return [];
    }
  }
}

/**
 * 纯函数三层合并：内置基线 → 在线（version >= 才覆盖）→ 本地自建（用户自己的优先）。
 * 本地自建 id 一律 `user.` 前缀，与内置 / 在线不撞；仍按同一套 Map 合并保证口径一致。
 */
function mergeLayers(
  online: readonly SkillRecipe[],
  user: readonly SkillRecipe[],
): SkillRecipe[] {
  const merged = new Map<string, SkillRecipe>();
  for (const builtin of BUILTIN_SKILLS) merged.set(builtin.id, builtin);
  for (const recipe of online) {
    const current = merged.get(recipe.id);
    if (current === undefined || recipe.version >= current.version) {
      merged.set(recipe.id, recipe);
    }
  }
  // 本地优先：用户刚写/刚改的技能必须立刻生效（同一会话说触发词即可验收），
  // 不受内置/在线版本号影响。纯声明零代码，不存在覆盖高版本导致的能力倒退风险。
  for (const recipe of user) merged.set(recipe.id, recipe);
  return [...merged.values()];
}

/** 默认构造：官方默认源 + 默认本地库 */
export function createDefaultSkillCatalog(deps: SkillCatalogDeps = {}): SkillCatalogService {
  return new SkillCatalogService(deps);
}

export { DEFAULT_SKILL_REGISTRY_URL };
