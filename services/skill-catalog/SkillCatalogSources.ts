/**
 * 在线技能源管理（单源模型：当前只有一个生效源）
 * @module services/skill-catalog/SkillCatalogSources
 *
 * 与插件源同款信任边界：
 * - 官方默认源是代码常量（weiqi-assets 的 skills/registry.json），由仓库 git 发布；
 * - 用户可把「当前源」改成任意 https registry URL（内容未经官方审核，UI 必须提示），
 *   也可一键恢复官方默认；
 * - 只存一个 URL，不做多源合并；
 * - URL 校验复用 validateRegistryUrl（https + 拒绝环回/私网字面地址）；
 * - 存储用 LocalStorageAdapter('weiqi-bot')，与插件源 / 用户自建技能同一命名空间。
 */

import { LocalStorageAdapter } from '@infrastructure/storage/adapters/web/LocalStorageAdapter';
import { validateRegistryUrl } from '@services/plugin-catalog/PluginCatalogUrl';
import { WEIQI_ASSETS_BASE_URL } from '@services/share/WeiqiAssetsUrls';

/** 官方默认技能源：站点根 + skills/registry.json（该文件现在是瘦索引） */
export const DEFAULT_SKILL_REGISTRY_URL = `${WEIQI_ASSETS_BASE_URL}skills/registry.json`;
export const SKILL_SOURCE_STORAGE_KEY = 'skill-catalog:current-source';

export interface SkillSource {
  url: string;
  /** true 表示当前就是官方默认源（用于 UI 标注与「恢复默认」按钮） */
  official: boolean;
}

export interface SkillCatalogSourcesDeps {
  localStorage?: LocalStorageAdapter;
}

export class SkillCatalogSources {
  private readonly store: LocalStorageAdapter;

  constructor(deps: SkillCatalogSourcesDeps = {}) {
    this.store = deps.localStorage ?? new LocalStorageAdapter('weiqi-bot');
  }

  /** 当前生效源。存储不可用 / 脏数据一律回落官方默认，不让面板白屏。 */
  async current(): Promise<SkillSource> {
    const stored = await this.readStored();
    if (stored === undefined || stored === DEFAULT_SKILL_REGISTRY_URL) {
      return { url: DEFAULT_SKILL_REGISTRY_URL, official: true };
    }
    return { url: stored, official: false };
  }

  /** 替换当前源；非法地址直接抛错（不写存储）。返回校验规范化后的 URL。 */
  async setCurrent(rawUrl: string): Promise<string> {
    try {
      const url = validateRegistryUrl(rawUrl);
      if (url === DEFAULT_SKILL_REGISTRY_URL) {
        await this.clearStored();
      } else {
        await this.writeStored(url);
      }
      return url;
    } catch {
      // 复用插件源同款校验（https + 拒绝环回/私网字面地址，不改 plugin 侧代码）。
      // 那条校验的错误文案写死了「插件源」，这里统一改述为技能源自己的约束，
      // 不靠子串替换原文案，避免上层看到错位的名词。
      throw new Error('技能源地址不合法：必须是公网 https（拒绝明文 http 与环回/私网地址）。');
    }
  }

  /** 恢复官方默认源 */
  async reset(): Promise<void> {
    await this.clearStored();
  }

  private async readStored(): Promise<string | undefined> {
    try {
      await this.store.initialize();
      const raw = await this.store.read<unknown>(SKILL_SOURCE_STORAGE_KEY);
      if (typeof raw !== 'string' || !raw.trim()) return undefined;
      // 历史脏数据 / 换协议 / 私网地址一律丢弃，回落到官方默认
      return validateRegistryUrl(raw);
    } catch {
      return undefined;
    }
  }

  private async writeStored(url: string): Promise<void> {
    await this.store.initialize();
    await this.store.write(SKILL_SOURCE_STORAGE_KEY, url);
  }

  private async clearStored(): Promise<void> {
    try {
      await this.store.initialize();
      await this.store.delete(SKILL_SOURCE_STORAGE_KEY);
    } catch {
      // 存储不可用时不写也仍是默认源语义
    }
  }
}
