/**
 * 在线插件源管理（默认源只读 + 用户自定义源）
 * @module services/plugin-catalog/PluginCatalogSources
 *
 * 信任边界：
 * - 官方默认源是代码常量，永远排第一、不可删除、不可被同名覆盖。
 *   它的发布通道只有 weiqi-assets 仓库的 git push，客户端不提供任何上传/改写路径。
 * - 自定义源由用户显式添加，内容未经官方审核，UI 必须提示自行承担信任。
 *   只接受 http/https 绝对 URL 且拒绝环回/私网字面地址（复用 URL 校验边界）。
 * - 存储用 LocalStorageAdapter('weiqi-bot')，与赛事页插件选择键同一命名空间。
 */

import { LocalStorageAdapter } from '@infrastructure/storage/adapters/web/LocalStorageAdapter';
import { validateRegistryUrl } from './PluginCatalogUrl';
import { WEIQI_ASSETS_REGISTRY_URL } from '@services/share/WeiqiAssetsUrls';
import type { CatalogSource } from './PluginCatalogTypes';

export const DEFAULT_REGISTRY_URL = WEIQI_ASSETS_REGISTRY_URL;
export const CUSTOM_SOURCES_STORAGE_KEY = 'plugin-catalog:custom-sources';

export interface PluginCatalogSourcesDeps {
  localStorage?: LocalStorageAdapter;
}

export class PluginCatalogSources {
  private readonly store: LocalStorageAdapter;

  constructor(deps: PluginCatalogSourcesDeps = {}) {
    this.store = deps.localStorage ?? new LocalStorageAdapter('weiqi-bot');
  }

  /**
   * 全部源：官方默认源恒在首位，后跟自定义源。
   * 存储不可用 / 数据损坏时静默降级为「只有默认源」，不让插件弹框白屏。
   */
  async list(): Promise<CatalogSource[]> {
    const custom = await this.readCustom();
    const seen = new Set<string>([DEFAULT_REGISTRY_URL]);
    const sources: CatalogSource[] = [{ url: DEFAULT_REGISTRY_URL, official: true }];
    for (const url of custom) {
      if (url === DEFAULT_REGISTRY_URL || seen.has(url)) continue;
      seen.add(url);
      sources.push({ url, official: false });
    }
    return sources;
  }

  /** 添加自定义源；返回校验规范化后的 URL。已存在 / 等于默认源时幂等返回 */
  async add(rawUrl: string): Promise<string> {
    const url = validateRegistryUrl(rawUrl);
    if (url === DEFAULT_REGISTRY_URL) return url;
    const custom = await this.readCustom();
    if (!custom.includes(url)) {
      custom.push(url);
      await this.writeCustom(custom);
    }
    return url;
  }

  /** 删除自定义源；官方默认源不可删（直接忽略） */
  async remove(rawUrl: string): Promise<void> {
    if (rawUrl === DEFAULT_REGISTRY_URL) return;
    const url = normalizeForCompare(rawUrl);
    const custom = await this.readCustom();
    const next = custom.filter((u) => u !== url && u !== rawUrl);
    if (next.length !== custom.length) await this.writeCustom(next);
  }

  isDefault(url: string): boolean {
    return normalizeForCompare(url) === DEFAULT_REGISTRY_URL;
  }

  private async readCustom(): Promise<string[]> {
    try {
      await this.store.initialize();
      const raw = await this.store.read<unknown>(CUSTOM_SOURCES_STORAGE_KEY);
      if (!Array.isArray(raw)) return [];
      const cleaned: string[] = [];
      for (const item of raw) {
        if (typeof item !== 'string' || !item.trim()) continue;
        try {
          const url = validateRegistryUrl(item);
          if (url !== DEFAULT_REGISTRY_URL && !cleaned.includes(url)) cleaned.push(url);
        } catch {
          // 丢弃历史脏数据（例如换了协议或私网地址），不阻塞列表展示
        }
      }
      return cleaned;
    } catch {
      return [];
    }
  }

  private async writeCustom(urls: string[]): Promise<void> {
    await this.store.initialize();
    await this.store.write(CUSTOM_SOURCES_STORAGE_KEY, urls);
  }
}

function normalizeForCompare(raw: string): string {
  try {
    return new URL(raw).toString();
  } catch {
    return raw;
  }
}
