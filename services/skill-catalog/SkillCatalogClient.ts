/**
 * 在线技能清单客户端（纯取数 + 结构校验，不执行任何远程代码）
 * @module services/skill-catalog/SkillCatalogClient
 *
 * 边界：
 * - URL 先过 validateRegistryUrl（https + 拒绝环回/私网字面地址），与插件平台同一策略；
 * - 远端正文只当文本读，JSON.parse 后交给 A 的 parseSkillRegistry 做唯一一次结构校验；
 * - 默认沿用浏览器 fetch 缓存语义；手动刷新（noStore）时传 cache:'no-store' 绕过
 *   浏览器/CDN 的 HTTP 缓存（在线源更新后列表仍显示旧正文的成因）；
 *   不重试、不设超时，不执行远程 JS、不求值；
 * - 任何一步失败都抛中文错误，由 SkillCatalogService 统一静默降级到内置技能。
 */

import { parseSkillRegistry } from '@application/skill/SkillRecipe';
import type { SkillRecipe } from '@application/skill/SkillTypes';
import { validateRegistryUrl } from '@services/plugin-catalog/PluginCatalogUrl';

export interface SkillCatalogClientDeps {
  /** 可注入的 fetch（测试用）；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
}

export class SkillCatalogClient {
  private readonly fetchImpl: typeof fetch;

  constructor(deps: SkillCatalogClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * 取一份在线技能清单，返回校验过的配方数组；失败抛中文错误。
   * noStore=true（面板「手动刷新」）时给底层 fetch 加 cache:'no-store'。
   */
  async fetchRegistry(url: string, noStore = false): Promise<SkillRecipe[]> {
    const safeUrl = this.validate(url);
    const res = await this.request(safeUrl, noStore);
    if (!res.ok) {
      throw new Error(`在线技能源返回 HTTP ${res.status}：${safeUrl}`);
    }
    const text = await this.readText(res);

    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new Error('在线技能源不是合法 JSON');
    }

    const parsed = parseSkillRegistry(raw);
    if (!parsed.ok) {
      throw new Error(`在线技能源格式不合法：${parsed.reason}`);
    }
    // 交副本，避免调用方直接改动校验器返回的数组
    return [...parsed.registry.skills];
  }

  private validate(url: string): string {
    try {
      return validateRegistryUrl(url);
    } catch (error) {
      throw new Error(`在线技能源 URL 不合法：${reasonOf(error)}`);
    }
  }

  private async request(safeUrl: string, noStore: boolean): Promise<Response> {
    try {
      return noStore
        ? await this.fetchImpl(safeUrl, { cache: 'no-store' })
        : await this.fetchImpl(safeUrl);
    } catch (error) {
      throw new Error(`在线技能源请求失败：${reasonOf(error)}`);
    }
  }

  private async readText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch (error) {
      throw new Error(`在线技能源正文读取失败：${reasonOf(error)}`);
    }
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
