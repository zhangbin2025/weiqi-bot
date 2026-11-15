/**
 * 在线插件源管理（单源模型：当前只有一个生效源）
 * @module services/plugin-catalog/PluginCatalogSources
 *
 * 信任边界：
 * - 官方默认源是代码常量，发布通道只有 weiqi-assets 仓库的 git push，
 *   客户端不提供任何上传/改写路径。
 * - 用户可以把「当前源」改成任意 https registry URL（内容未经官方审核，
 *   UI 必须提示自行承担信任），也可以一键恢复官方默认。
 * - 只存一个 URL：不做多源合并，避免同一地址在界面里出现两次。
 * - 存储用 LocalStorageAdapter('weiqi-bot')，与赛事页插件选择键同一命名空间。
 */

import { LocalStorageAdapter } from '@infrastructure/storage/adapters/web/LocalStorageAdapter';
import { validateRegistryUrl } from './PluginCatalogUrl';
import { WEIQI_ASSETS_REGISTRY_URL } from '@services/share/WeiqiAssetsUrls';
import type { CatalogSource } from './PluginCatalogTypes';

export const DEFAULT_REGISTRY_URL = WEIQI_ASSETS_REGISTRY_URL;
export const CURRENT_SOURCE_STORAGE_KEY = 'plugin-catalog:current-source';

export interface PluginCatalogSourcesDeps {
  localStorage?: LocalStorageAdapter;
}

export class PluginCatalogSources {
  private readonly store: LocalStorageAdapter;

  constructor(deps: PluginCatalogSourcesDeps = {}) {
    this.store = deps.localStorage ?? new LocalStorageAdapter('weiqi-bot');
  }

  /**
   * 当前生效源。存储不可用 / 数据损坏时静默降级为官方默认源，不让插件弹框白屏。
   * official 为 true 表示「当前就是官方默认源」，用于 UI 标注与恢复按钮禁用。
   */
  async current(): Promise<CatalogSource> {
    const stored = await this.readStored();
    if (stored === undefined || stored === DEFAULT_REGISTRY_URL) {
      return { url: DEFAULT_REGISTRY_URL, official: true };
    }
    return { url: stored, official: false };
  }

  /** 替换当前源；返回校验规范化后的 URL。非法地址直接抛错（不写存储） */
  async setCurrent(rawUrl: string): Promise<string> {
    const url = validateRegistryUrl(rawUrl);
    if (url === DEFAULT_REGISTRY_URL) {
      await this.clearStored();
    } else {
      await this.writeStored(url);
    }
    return url;
  }

  /** 恢复官方默认源 */
  async reset(): Promise<void> {
    await this.clearStored();
  }

  /** 语义化别名：UI 只跟 Service 打交道，仍用 list() 之外的命名 */
  async list(): Promise<CatalogSource[]> {
    return [await this.current()];
  }

  /** URL 归一化后与官方默认源比较 */
  isDefault(url: string): boolean {
    try {
      return new URL(url).toString() === DEFAULT_REGISTRY_URL;
    } catch {
      return url === DEFAULT_REGISTRY_URL;
    }
  }

  private async readStored(): Promise<string | undefined> {
    try {
      await this.store.initialize();
      const raw = await this.store.read<unknown>(CURRENT_SOURCE_STORAGE_KEY);
      if (typeof raw !== 'string' || !raw.trim()) return undefined;
      // 历史脏数据 / 换协议 / 私网地址一律丢弃，回落到官方默认
      return validateRegistryUrl(raw);
    } catch {
      return undefined;
    }
  }

  private async writeStored(url: string): Promise<void> {
    await this.store.initialize();
    await this.store.write(CURRENT_SOURCE_STORAGE_KEY, url);
  }

  private async clearStored(): Promise<void> {
    try {
      await this.store.initialize();
      await this.store.delete(CURRENT_SOURCE_STORAGE_KEY);
    } catch {
      // 存储不可用时不写也仍是默认源语义
    }
  }
}
