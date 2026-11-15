/**
 * 在线技能编排：内置兜底 + 在线叠加（只合并纯声明 JSON 配方）
 * @module services/skill-catalog/SkillCatalogService
 *
 * 边界（契约 §5 / §7.5）：
 * - 以 A 的 BUILTIN_SKILLS 为基线（零网络、永远可用），再请求在线默认源；
 * - 在线失败 / 格式错 / URL 不合法一律静默返回内置，绝不把异常抛到 UI；
 * - 成功则按 id 合并：在线 version >= 当前已合并版本才覆盖，在线独有 id 直接加入，
 *   这样「新增围棋能力只加一条 JSON」才成立；低版本不会覆盖更高版本；
 * - 不缓存、不重试、不设超时（沿用浏览器 fetch 默认）；不执行任何远程代码；
 *   不设阈值、不打分、不调用模型。
 */

import { BUILTIN_SKILLS } from '@application/skill/BuiltinSkills';
import type { SkillRecipe } from '@application/skill/SkillTypes';
import { WEIQI_ASSETS_BASE_URL } from '@services/share/WeiqiAssetsUrls';
import { SkillCatalogClient } from './SkillCatalogClient';

/** 在线默认源：站点根 + skills/registry.json，域名只来自 WeiqiAssetsUrls */
const DEFAULT_SKILL_REGISTRY_URL = `${WEIQI_ASSETS_BASE_URL}skills/registry.json`;

export interface SkillCatalogDeps {
  /** 可注入的 fetch（测试用）；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
  /** 可注入的在线源 URL（测试用）；默认 DEFAULT_SKILL_REGISTRY_URL */
  onlineUrl?: string;
}

export class SkillCatalogService {
  private readonly client: SkillCatalogClient;
  private readonly onlineUrl: string;

  constructor(deps: SkillCatalogDeps = {}) {
    // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined
    const clientDeps: { fetchImpl?: typeof fetch } = {};
    if (deps.fetchImpl !== undefined) clientDeps.fetchImpl = deps.fetchImpl;
    this.client = new SkillCatalogClient(clientDeps);
    this.onlineUrl = deps.onlineUrl ?? DEFAULT_SKILL_REGISTRY_URL;
  }

  /** 每轮重新取一次在线源；任何失败静默回落到内置副本 */
  async loadSkills(): Promise<SkillRecipe[]> {
    let online: SkillRecipe[];
    try {
      online = await this.client.fetchRegistry(this.onlineUrl);
    } catch {
      return [...BUILTIN_SKILLS];
    }
    return mergeSkills(online);
  }
}

/** 纯函数合并：内置基线 → 逐条叠加在线配方，始终保留每个 id 的最高版本 */
function mergeSkills(online: readonly SkillRecipe[]): SkillRecipe[] {
  const merged = new Map<string, SkillRecipe>();
  for (const builtin of BUILTIN_SKILLS) {
    merged.set(builtin.id, builtin);
  }
  for (const recipe of online) {
    const current = merged.get(recipe.id);
    // current 初始即内置，故「>= 内置才覆盖」成立；在线独有 id 直接加入
    if (current === undefined || recipe.version >= current.version) {
      merged.set(recipe.id, recipe);
    }
  }
  return [...merged.values()];
}

/** 默认构造：用 WEIQI_ASSETS_BASE_URL 拼出的默认在线源 */
export function createDefaultSkillCatalog(): SkillCatalogService {
  return new SkillCatalogService();
}
