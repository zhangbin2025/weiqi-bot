/**
 * 在线技能清单客户端（两段式纯取数 + 结构校验，不执行任何远程代码）
 * @module services/skill-catalog/SkillCatalogClient
 *
 * 边界：
 * - URL 先过 validateRegistryUrl（https + 拒绝环回/私网字面地址），与插件平台同一策略；
 * - 两段式取数：先取 skills/registry.json（瘦索引，schemaVersion:2），再由索引
 *   逐条取 skills/<id>/skill.json（完整配方，schemaVersion:1）。每个 URL 一次 GET，
 *   远端正文只当文本读，JSON.parse 后两段各做一次结构校验（索引 + 配方），
 *   最后对索引/配方的重叠字段做一致性比对，防索引骗人（尤其 version 决定「有更新」判定）；
 * - 路径拼接直接复用插件侧 resolveBaseUrl / resolveSameOrigin（已含拒绝绝对路径 /
 *   反斜杠 / .. 越界 / 站外 origin / 非 https 的校验）；单条路径解析失败只跳过该条，
 *   不抛错毁掉整份清单；
 * - 默认沿用浏览器 fetch 缓存语义；手动刷新（noStore）时给两段每个请求都传
 *   cache:'no-store' 绕过浏览器/CDN 的 HTTP 缓存，避免索引新、配方旧的静默漂移；
 *   不重试、不设超时，不执行远程 JS、不求值；
 * - 任何一步失败都抛中文错误，由 SkillCatalogService 统一静默降级到内置技能。
 */

import { parseSkillRecipe, parseSkillRegistryIndex } from '@application/skill/SkillRecipe';
import type { SkillIndexEntry, SkillRecipe } from '@application/skill/SkillTypes';
import { validateRegistryUrl } from '@services/plugin-catalog/PluginCatalogUrl';
import { resolveBaseUrl, resolveSameOrigin } from '@services/plugin-catalog/PluginCatalogClient';

export interface SkillCatalogClientDeps {
  /** 可注入的 fetch（测试用）；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
}

/** 一条索引条目 + 已验证同源的 skill.json 绝对 URL */
export interface ParsedSkillEntry {
  entry: SkillIndexEntry;
  skillUrl: string;
  baseUrl: string;
}

export interface ParsedSkillRegistry {
  registryUrl: string;
  baseUrl: string;
  entries: ParsedSkillEntry[];
}

export class SkillCatalogClient {
  private readonly fetchImpl: typeof fetch;

  constructor(deps: SkillCatalogClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * 取并校验瘦索引，逐条拼出 skill.json 的 URL；失败抛中文错误。
   * noStore=true（面板「手动刷新」）时给底层 fetch 加 cache:'no-store'。
   */
  async fetchRegistry(url: string, noStore = false): Promise<ParsedSkillRegistry> {
    const safeUrl = this.validate(url);
    const text = await this.getText(safeUrl, noStore);
    const raw = this.parseJson(text);

    const parsed = parseSkillRegistryIndex(raw);
    if (!parsed.ok) {
      throw new Error(`在线技能源格式不合法：${parsed.reason}`);
    }
    // 等价于索引原文的 baseUrl，但取的是已过校验的形状（缺省 / 空串都已省略）。
    const base = resolveBaseUrl(safeUrl, parsed.registry.baseUrl);
    const entries: ParsedSkillEntry[] = [];
    for (const entry of parsed.registry.skills) {
      try {
        const skillUrl = resolveSameOrigin(entry.path, base, safeUrl);
        entries.push({ entry, skillUrl, baseUrl: base });
      } catch {
        // 路径非法只跳过该条（与插件侧同款语义），不让整份清单失效
      }
    }
    return { registryUrl: safeUrl, baseUrl: base, entries };
  }

  /**
   * 取单条完整配方：结构校验 + 与索引条目的重叠字段一致性比对。
   * 比的是「解析后」的值（两个解析器各自 trim / 宽松处理过）；数组逐项比较，
   * 两边都 undefined 算一致。任一不符抛中文错误，由 browse 把该条标 unavailable。
   */
  async fetchSkill(item: ParsedSkillEntry, noStore = false): Promise<SkillRecipe> {
    const text = await this.getText(item.skillUrl, noStore);
    const raw = this.parseJson(text);
    const parsed = parseSkillRecipe(raw);
    if (!parsed.ok) {
      throw new Error(`在线技能源格式不合法：${parsed.reason}`);
    }
    const entry = item.entry;
    const skill = parsed.skill;
    const overlaps: ReadonlyArray<readonly [string, unknown, unknown]> = [
      ['id', entry.id, skill.id],
      ['version', entry.version, skill.version],
      ['name', entry.name, skill.name],
      ['summary', entry.summary, skill.summary],
      ['routeHint', entry.routeHint, skill.routeHint],
      ['primitives', entry.primitives, skill.primitives],
      ['category', entry.category, skill.category],
    ];
    for (const [field, left, right] of overlaps) {
      if (!sameOverlapValue(left, right)) {
        throw new Error(`skill.json 与索引条目不一致：字段 ${field}（${entry.id}）`);
      }
    }
    return skill;
  }

  private validate(url: string): string {
    try {
      return validateRegistryUrl(url);
    } catch (error) {
      throw new Error(`在线技能源 URL 不合法：${reasonOf(error)}`);
    }
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('在线技能源不是合法 JSON');
    }
  }

  private async getText(url: string, noStore: boolean): Promise<string> {
    let res: Response;
    try {
      res = noStore
        ? await this.fetchImpl(url, { cache: 'no-store' })
        : await this.fetchImpl(url);
    } catch (error) {
      throw new Error(`在线技能源请求失败：${reasonOf(error)}`);
    }
    if (!res.ok) {
      throw new Error(`在线技能源返回 HTTP ${res.status}：${url}`);
    }
    try {
      return await res.text();
    } catch (error) {
      throw new Error(`在线技能源正文读取失败：${reasonOf(error)}`);
    }
  }
}

/** 数组逐项比较；非数组按 ===（两边都 undefined 自然算一致） */
function sameOverlapValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
