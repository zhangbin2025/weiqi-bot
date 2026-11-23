/** @vitest-environment jsdom */
/**
 * 安装 / 更新后的面板落点（2026-11-21 用户决策）
 *
 * 不管是插件还是技能，「安装」和「更新」都必须：
 * 1. 切到「本地插件」/「我的技能」标签页；
 * 2. 把定位目标指向本地库里那一条（data-panel-key = local:<id>），
 *    而不是留在在线页指回在线条目；
 * 3. 触发面板刷新（刷新时 applyFlash 才会消费定位目标并高亮）。
 *
 * 插件新装额外带 enableHint（默认停用、需手动启用）；更新保留原启停状态，
 * 不该再弹这条提示。技能安装即刻生效，也不带该提示。
 *
 * 与同目录其它用例一致：Object.create(prototype) 绕过整页实例化，
 * 只注入被测方法真正碰到的端口。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatPage } from '../ChatPage';
import type { CatalogEntry } from '../../../../../services/plugin-catalog/PluginCatalogTypes';
import type { PluginCatalogService } from '../../../../../services/plugin-catalog/PluginCatalogService';
import type { PluginArtifact } from '../../../../../domain/plugin/types';
import type { SkillRecipe } from '../../../../../application/skill/SkillTypes';
import type {
  SkillBrowseItem, SkillCatalogService,
} from '../../../../../services/skill-catalog/SkillCatalogService';
import type { SkillSource } from '../../../../../services/skill-catalog/SkillCatalogSources';

function makePage(): ChatPage & Record<string, unknown> {
  const page = Object.create(ChatPage.prototype) as ChatPage & Record<string, unknown>;
  // 模拟用户当前正停在「在线」标签：改完必须显式切回 local 才算过
  page['pluginPanelTab'] = 'online';
  page['skillPanelTab'] = 'online';
  page['pluginPanelFocus'] = undefined;
  page['skillPanelFocus'] = undefined;
  page['pluginPanelFlash'] = undefined;
  page['skillPanelFlash'] = undefined;
  page['refreshPluginPanel'] = vi.fn(async () => {});
  page['refreshSkillPanel'] = vi.fn(async () => {});
  // 阶段二：插件安装/更新成功路径会 await this.refreshOperatorRegistry() 重建算子表快照。
  // 本文件用 Object.create(prototype) 绕过构造函数，实例字段不会自动初始化；
  // 不补这个 noop，成功路径会抛错被 catch 吞掉、refreshPluginPanel 永远不被调用。
  // 安装失败用例走失败分支、不碰它，因此仍保持通过。
  page['refreshOperatorRegistry'] = vi.fn(async () => {});
  page['showPluginError'] = vi.fn();
  page['showSkillError'] = vi.fn();
  return page;
}

function catalogEntry(state: 'new' | 'update'): CatalogEntry {
  return {
    registryUrl: 'https://example.com/registry.json',
    official: true,
    resourceId: 'ranking.total-score',
    kind: 'plugin',
    name: '总分排序',
    summary: '按总分排名',
    state,
    remoteCode: 'function rank() {}',
    intent: '按总分排名',
  };
}

function fakeArtifact(id: string): PluginArtifact {
  return { id } as unknown as PluginArtifact;
}

function fakePluginCatalog(install: ReturnType<typeof vi.fn>): PluginCatalogService {
  return { install } as unknown as PluginCatalogService;
}

function findButton(card: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(card.querySelectorAll('button'))
    .find((b) => b.textContent === label);
  if (!btn) throw new Error(`卡片里找不到「${label}」按钮`);
  return btn;
}

/** 点按钮后等刷新被调用：按钮回调是 void async IIFE，不能直接 await */
async function clickAndFlush(btn: HTMLButtonElement, refresh: ReturnType<typeof vi.fn>): Promise<void> {
  btn.click();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
}

const recipe: SkillRecipe = {
  schemaVersion: 1,
  id: 'weather.wttr',
  version: 2,
  name: '天气查询',
  summary: '查城市天气',
  primitives: ['http_fetch'],
  prompt: '用 http_fetch 查天气',
};

function skillItem(state: 'new' | 'update'): SkillBrowseItem {
  return { recipe, state };
}

const skillSource: SkillSource = { url: 'https://example.com/skills.json', official: true };

function fakeSkillCatalog(install: ReturnType<typeof vi.fn>): SkillCatalogService {
  return { install } as unknown as SkillCatalogService;
}

describe('插件安装/更新 → 跳本地标签页并定位条目', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('安装：切到「本地插件」，定位 local:<artifactId>，带默认停用提示', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({
      ok: true, action: 'installed', artifact: fakeArtifact('art-1'),
      message: '已安装（默认停用），请在「本地插件」里启用',
    }));
    const card = (page['buildCatalogCard'] as (
      e: CatalogEntry, c: PluginCatalogService,
    ) => HTMLElement).call(page, catalogEntry('new'), fakePluginCatalog(install));

    await clickAndFlush(findButton(card, '安装'), page['refreshPluginPanel'] as ReturnType<typeof vi.fn>);

    expect(install).toHaveBeenCalledTimes(1);
    expect(page['pluginPanelTab']).toBe('local');
    expect(page['pluginPanelFocus']).toEqual({ key: 'local:art-1', enableHint: true });
    expect(page['pluginPanelFlash']).toEqual({ text: expect.stringContaining('已安装'), error: false });
  });

  it('更新：同样切到「本地插件」，定位 local:<artifactId>，不弹「需手动启用」', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({
      ok: true, action: 'updated', artifact: fakeArtifact('art-1'),
      message: '已更新源码（保留历史版本）',
    }));
    const card = (page['buildCatalogCard'] as (
      e: CatalogEntry, c: PluginCatalogService,
    ) => HTMLElement).call(page, catalogEntry('update'), fakePluginCatalog(install));

    await clickAndFlush(findButton(card, '更新'), page['refreshPluginPanel'] as ReturnType<typeof vi.fn>);

    expect(page['pluginPanelTab']).toBe('local');
    expect(page['pluginPanelFocus']).toEqual({ key: 'local:art-1' });
    expect((page['pluginPanelFocus'] as { enableHint?: boolean }).enableHint).toBeUndefined();
  });

  it('安装失败：不改标签页、不设定位目标', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({ ok: false, action: 'rejected', message: '源码不可用' }));
    const card = (page['buildCatalogCard'] as (
      e: CatalogEntry, c: PluginCatalogService,
    ) => HTMLElement).call(page, catalogEntry('new'), fakePluginCatalog(install));

    await clickAndFlush(findButton(card, '安装'), page['refreshPluginPanel'] as ReturnType<typeof vi.fn>);

    expect(page['pluginPanelTab']).toBe('online');
    expect(page['pluginPanelFocus']).toBeUndefined();
    expect(page['pluginPanelFlash']).toEqual({ text: '源码不可用', error: true });
  });
});

describe('技能安装/更新 → 跳「我的技能」并定位条目', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('安装：切到「我的技能」，定位 local:<recipe.id>', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({
      ok: true, action: 'installed', message: '已安装到「我的技能」，即刻生效。',
    }));
    const card = (page['buildOnlineSkillCard'] as (
      i: SkillBrowseItem, s: SkillSource, c: SkillCatalogService,
    ) => HTMLElement).call(page, skillItem('new'), skillSource, fakeSkillCatalog(install));

    await clickAndFlush(findButton(card, '安装'), page['refreshSkillPanel'] as ReturnType<typeof vi.fn>);

    expect(install).toHaveBeenCalledWith(recipe);
    expect(page['skillPanelTab']).toBe('local');
    expect(page['skillPanelFocus']).toEqual({ key: 'local:weather.wttr' });
  });

  it('更新：同样切到「我的技能」，定位 local:<recipe.id>', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({
      ok: true, action: 'updated', message: '已更新（保留启停状态）。',
    }));
    const card = (page['buildOnlineSkillCard'] as (
      i: SkillBrowseItem, s: SkillSource, c: SkillCatalogService,
    ) => HTMLElement).call(page, skillItem('update'), skillSource, fakeSkillCatalog(install));

    await clickAndFlush(findButton(card, '更新'), page['refreshSkillPanel'] as ReturnType<typeof vi.fn>);

    expect(page['skillPanelTab']).toBe('local');
    expect(page['skillPanelFocus']).toEqual({ key: 'local:weather.wttr' });
  });

  it('安装失败：不改标签页、不设定位目标', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({ ok: false, action: 'rejected', message: '缺少原语' }));
    const card = (page['buildOnlineSkillCard'] as (
      i: SkillBrowseItem, s: SkillSource, c: SkillCatalogService,
    ) => HTMLElement).call(page, skillItem('new'), skillSource, fakeSkillCatalog(install));

    await clickAndFlush(findButton(card, '安装'), page['refreshSkillPanel'] as ReturnType<typeof vi.fn>);

    expect(page['skillPanelTab']).toBe('online');
    expect(page['skillPanelFocus']).toBeUndefined();
    expect(page['skillPanelFlash']).toEqual({ text: '缺少原语', error: true });
  });
});

describe('定位目标落到本地卡片', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('按 data-panel-key 命中那一条：加高亮并滚到可见处', () => {
    const page = Object.create(ChatPage.prototype) as ChatPage & Record<string, unknown>;
    const body = document.createElement('div');
    for (const key of ['local:other', 'local:art-1']) {
      const card = document.createElement('div');
      card.className = 'plugin-panel__card';
      card.dataset['panelKey'] = key;
      card.scrollIntoView = vi.fn();
      body.appendChild(card);
    }

    (page['applyPanelFocus'] as (b: HTMLElement, f: unknown) => void)
      .call(page, body, { key: 'local:art-1' });

    const cards = body.querySelectorAll<HTMLElement>('.plugin-panel__card');
    expect(cards[0]!.classList.contains('plugin-panel__card--focus')).toBe(false);
    expect(cards[1]!.classList.contains('plugin-panel__card--focus')).toBe(true);
    expect(cards[1]!.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });
});
