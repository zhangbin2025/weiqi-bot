/** @vitest-environment jsdom */
/**
 * 插件/技能四个列表的分类标签与筛选（2026-11-21 需求）
 *
 * 覆盖：
 * 1. 分类推导：清单显式 category 优先，缺省按 pointId / id 命名空间兜底，
 *    推不出 → 未分类；未知标签不硬塞进某个类。
 * 2. 卡片：本地/在线 × 插件/技能都有可见分类标签，并写 data-category 供筛选。
 * 3. 标签条：默认「全部」不筛选，只列当前列表实际出现的分类，单选。
 * 4. 点标签是纯前端切换可见性，不重新 browse / list（不打网络、不闪 loading）。
 * 5. 安装/更新成功后筛选重置为「全部」，保证刚操作的本地条目一定可见。
 *
 * 与同目录其它用例一致：Object.create(prototype) 绕过整页实例化，只注入被测方法碰到的端口。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ChatPage, CATEGORY_ALL, EXTENSION_CATEGORIES,
  normalizeCategory, pluginCategory, skillCategory,
} from '../ChatPage';
import type { CatalogEntry } from '../../../../../services/plugin-catalog/PluginCatalogTypes';
import type { PluginCatalogService } from '../../../../../services/plugin-catalog/PluginCatalogService';
import type { PluginArtifact } from '../../../../../domain/plugin/types';
import type { SkillRecipe } from '../../../../../application/skill/SkillTypes';
import type {
  SkillBrowseItem, SkillCatalogBrowseResult, SkillCatalogService,
} from '../../../../../services/skill-catalog/SkillCatalogService';
import type { SkillSource } from '../../../../../services/skill-catalog/SkillCatalogSources';
import type { UserSkillEntry } from '../../../../../application/skill/dev/UserSkillStore';

type Page = ChatPage & Record<string, unknown>;

function makePage(): Page {
  const page = Object.create(ChatPage.prototype) as Page;
  page['pluginPanelSeq'] = 0;
  page['skillPanelSeq'] = 0;
  page['pluginPanelTab'] = 'local';
  page['skillPanelTab'] = 'local';
  page['pluginCategoryFilter'] = CATEGORY_ALL;
  page['skillCategoryFilter'] = CATEGORY_ALL;
  page['pluginPanelFlash'] = undefined;
  page['skillPanelFlash'] = undefined;
  page['pluginPanelFocus'] = undefined;
  page['skillPanelFocus'] = undefined;
  page['skillPrimitives'] = new Set<string>();
  page['showPluginError'] = vi.fn();
  page['showSkillError'] = vi.fn();
  return page;
}

function dom(ids: { root: string; categories: string; body: string }): void {
  document.body.innerHTML =
    `<div class="plugin-panel" id="${ids.root}">`
    + `<div id="${ids.root.replace('Root', 'Tabs')}"></div>`
    + `<div class="plugin-panel__categories" id="${ids.categories}"></div>`
    + `<div id="${ids.body}"></div>`
    + '</div>';
}

function cards(bodyId: string): HTMLElement[] {
  return Array.from(document.getElementById(bodyId)!.querySelectorAll<HTMLElement>('.plugin-panel__card'));
}

function categoryButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.plugin-panel__categories button'));
}

function clickCategory(label: string): void {
  const btn = categoryButtons().find((b) => b.textContent === label);
  if (!btn) throw new Error(`找不到分类按钮「${label}」；现有：${categoryButtons().map((b) => b.textContent).join('/')}`);
  btn.click();
}

function recipe(id: string, category?: string): SkillRecipe {
  return {
    schemaVersion: 1, id, version: 1, name: id, summary: `配方 ${id}`,
    primitives: [], prompt: '指令', ...(category !== undefined ? { category } : {}),
  } as SkillRecipe;
}

function artifact(id: string, pointId: string, category?: string): PluginArtifact {
  return {
    id, pointId, name: `插件 ${id}`, version: 1, enabled: false,
    intent: '演示', code: 'function rank(){}', updatedAt: 0,
    ...(category !== undefined ? { category } : {}),
  } as unknown as PluginArtifact;
}

function catalogEntry(id: string, pointId: string, category?: string): CatalogEntry {
  return {
    registryUrl: 'https://example.com/registry.json', official: true,
    resourceId: id, kind: 'plugin', name: `在线 ${id}`, summary: '摘要',
    state: 'new', intent: '演示', ...(category !== undefined ? { category } : {}),
    ...(pointId !== undefined ? { pointId } : {}),
  } as CatalogEntry;
}

const skillSource: SkillSource = { url: 'https://example.com/skills.json', official: true };

describe('分类推导：来源清楚、可复算', () => {
  it('插件按 pointId 推导两个已注册扩展点', () => {
    expect(pluginCategory('ranking')).toBe('排名');
    expect(pluginCategory('workflow-operator')).toBe('算子');
    expect(pluginCategory('something-new')).toBe('未分类');
    expect(pluginCategory(undefined)).toBe('未分类');
  });

  it('技能按 id 第一段命名空间推导', () => {
    expect(skillCategory('puzzle.tsumego')).toBe('围棋');
    expect(skillCategory('play.start')).toBe('围棋');
    expect(skillCategory('stock.quote')).toBe('财经');
    expect(skillCategory('tavily.search')).toBe('搜索');
    expect(skillCategory('weather.wttr')).toBe('生活');
    expect(skillCategory('github.rest')).toBe('开发');
    expect(skillCategory('mine.custom')).toBe('未分类');
  });

  it('清单显式 category 优先；不认识的值当没写，走兜底', () => {
    expect(pluginCategory('ranking', '财经')).toBe('财经');
    expect(skillCategory('github.rest', '围棋')).toBe('围棋');
    expect(pluginCategory('ranking', '火星')).toBe('排名');
    expect(skillCategory('puzzle.tsumego', '火星')).toBe('围棋');
  });

  it('normalizeCategory 只放行白名单内、去空白', () => {
    expect(normalizeCategory(' 围棋 ')).toBe('围棋');
    expect(normalizeCategory('火星')).toBeUndefined();
    expect(normalizeCategory(42)).toBeUndefined();
    expect(normalizeCategory(undefined)).toBeUndefined();
    expect(EXTENSION_CATEGORIES).toContain('未分类');
  });
});

describe('本地插件列表：标签条 + 筛选', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('默认「全部」：两张不同分类卡片都可见，各自带分类标签', async () => {
    const page = makePage();
    const list = vi.fn(async () => [
      artifact('a1', 'ranking'), artifact('a2', 'workflow-operator'),
    ]);
    page['plugin'] = { artifacts: { list } };
    dom({ root: 'pluginPanelRoot', categories: 'pluginPanelCategories', body: 'pluginPanelBody' });

    await (page['refreshPluginPanel'] as () => Promise<void>).call(page);

    const listCards = cards('pluginPanelBody');
    expect(listCards).toHaveLength(2);
    expect(listCards[0]!.dataset['category']).toBe('排名');
    expect(listCards[1]!.dataset['category']).toBe('算子');
    expect(listCards[0]!.hidden).toBe(false);
    expect(listCards[1]!.hidden).toBe(false);
    // 卡片头有可见分类标签
    expect(listCards[0]!.querySelector('.plugin-panel__category-tag')?.textContent).toBe('排名');
    // 标签条：全部 + 本列表实际出现的两个分类
    const labels = categoryButtons().map((b) => b.textContent);
    expect(labels).toEqual(['全部', '排名', '算子']);
    expect(categoryButtons()[0]!.classList.contains('plugin-panel__category--active')).toBe(true);
  });

  it('点「排名」只隐藏算子卡片；不重新 list（不打网络）', async () => {
    const page = makePage();
    const list = vi.fn(async () => [
      artifact('a1', 'ranking'), artifact('a2', 'workflow-operator'),
    ]);
    page['plugin'] = { artifacts: { list } };
    dom({ root: 'pluginPanelRoot', categories: 'pluginPanelCategories', body: 'pluginPanelBody' });
    await (page['refreshPluginPanel'] as () => Promise<void>).call(page);
    expect(list).toHaveBeenCalledTimes(1);

    clickCategory('排名');
    expect(page['pluginCategoryFilter']).toBe('排名');
    const listCards = cards('pluginPanelBody');
    expect(listCards[0]!.hidden).toBe(false);
    expect(listCards[1]!.hidden).toBe(true);
    // 纯前端筛选：不重新读数据
    expect(list).toHaveBeenCalledTimes(1);
    expect(categoryButtons().find((b) => b.textContent === '排名')!
      .classList.contains('plugin-panel__category--active')).toBe(true);

    clickCategory('全部');
    expect(page['pluginCategoryFilter']).toBe(CATEGORY_ALL);
    expect(cards('pluginPanelBody').every((c) => !c.hidden)).toBe(true);
  });
});

describe('在线插件列表：标签条 + 筛选', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('在线条目也写 data-category，点标签只切可见性、不重新 browse', async () => {
    const page = makePage();
    const browse = vi.fn(async () => ({
      entries: [
        catalogEntry('ranking.total-score', 'ranking', '排名'),
        catalogEntry('workflow-operator.lunar', 'workflow-operator', '算子'),
      ],
      failures: [],
    }));
    const currentSource = vi.fn(async () => ({ url: 'https://example.com/registry.json', official: true }));
    page['catalog'] = { browse, currentSource };
    page['pluginPanelTab'] = 'online';
    dom({ root: 'pluginPanelRoot', categories: 'pluginPanelCategories', body: 'pluginPanelBody' });

    await (page['refreshPluginPanel'] as () => Promise<void>).call(page);
    expect(browse).toHaveBeenCalledTimes(1);
    const listCards = cards('pluginPanelBody');
    expect(listCards.map((c) => c.dataset['category'])).toEqual(['排名', '算子']);

    clickCategory('算子');
    expect(listCards[0]!.hidden).toBe(true);
    expect(listCards[1]!.hidden).toBe(false);
    expect(browse).toHaveBeenCalledTimes(1);
    // 源管理器不是卡片：筛选不该把它藏掉
    expect((document.querySelector('.plugin-panel__sources') as HTMLElement).hidden).toBe(false);
  });
});

describe('本地技能 / 在线技能列表：标签条 + 筛选', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('本地技能：两条不同分类，默认全显示，点「财经」只留财经', async () => {
    const page = makePage();
    const list = vi.fn(async () => [
      { recipe: recipe('puzzle.tsumego'), source: 'online', enabled: true },
      { recipe: recipe('stock.quote'), source: 'online', enabled: true },
    ] as UserSkillEntry[]);
    page['skillCatalog'] = { userStore: () => ({ list }) };
    dom({ root: 'skillPanelRoot', categories: 'skillPanelCategories', body: 'skillPanelBody' });

    await (page['refreshSkillPanel'] as () => Promise<void>).call(page);
    const listCards = cards('skillPanelBody');
    expect(listCards.map((c) => c.dataset['category'])).toEqual(['围棋', '财经']);
    expect(listCards[0]!.querySelector('.plugin-panel__category-tag')?.textContent).toBe('围棋');
    expect(categoryButtons().map((b) => b.textContent)).toEqual(['全部', '围棋', '财经']);

    clickCategory('财经');
    expect(listCards[0]!.hidden).toBe(true);
    expect(listCards[1]!.hidden).toBe(false);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('在线技能：data-category 来自 recipe，点标签不重新 browse', async () => {
    const page = makePage();
    const r1 = recipe('weather.wttr', '生活');
    const r2 = recipe('github.rest', '开发');
    const items: SkillBrowseItem[] = [
      { recipe: r1, state: 'new' }, { recipe: r2, state: 'new' },
    ];
    const browse = vi.fn(async () => ({
      source: skillSource, items,
    } as SkillCatalogBrowseResult));
    page['skillCatalog'] = { browse } as unknown as SkillCatalogService;
    page['skillPanelTab'] = 'online';
    dom({ root: 'skillPanelRoot', categories: 'skillPanelCategories', body: 'skillPanelBody' });

    await (page['refreshSkillPanel'] as () => Promise<void>).call(page);
    expect(browse).toHaveBeenCalledTimes(1);
    const listCards = cards('skillPanelBody');
    expect(listCards.map((c) => c.dataset['category'])).toEqual(['生活', '开发']);

    clickCategory('开发');
    expect(listCards[0]!.hidden).toBe(true);
    expect(listCards[1]!.hidden).toBe(false);
    expect(browse).toHaveBeenCalledTimes(1);
  });
});

describe('安装/更新成功后筛选重置，保证定位条目可见', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('插件：原先筛「排名」，装完回到「全部」', async () => {
    const page = makePage();
    page['pluginPanelTab'] = 'online';
    page['pluginCategoryFilter'] = '排名';
    page['refreshPluginPanel'] = vi.fn(async () => {});
    const install = vi.fn(async () => ({
      ok: true, action: 'installed', artifact: artifact('a1', 'ranking'), message: '已安装',
    }));
    const card = (page['buildCatalogCard'] as (
      e: CatalogEntry, c: PluginCatalogService,
    ) => HTMLElement).call(page, catalogEntry('ranking.total-score', 'ranking'),
      { install } as unknown as PluginCatalogService);
    const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '安装')!;
    btn.click();
    await vi.waitFor(() => expect(page['refreshPluginPanel']).toHaveBeenCalled());

    expect(page['pluginPanelTab']).toBe('local');
    expect(page['pluginCategoryFilter']).toBe(CATEGORY_ALL);
    expect(page['pluginPanelFocus']).toEqual({ key: 'local:a1', enableHint: true });
  });

  it('技能：原先筛「围棋」，装完回到「全部」', async () => {
    const page = makePage();
    page['skillPanelTab'] = 'online';
    page['skillCategoryFilter'] = '围棋';
    page['refreshSkillPanel'] = vi.fn(async () => {});
    const install = vi.fn(async () => ({ ok: true, action: 'installed', message: '已安装' }));
    const item: SkillBrowseItem = { recipe: recipe('weather.wttr'), state: 'new' };
    const card = (page['buildOnlineSkillCard'] as (
      i: SkillBrowseItem, s: SkillSource, c: SkillCatalogService,
    ) => HTMLElement).call(page, item, skillSource,
      { install } as unknown as SkillCatalogService);
    const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '安装')!;
    btn.click();
    await vi.waitFor(() => expect(page['refreshSkillPanel']).toHaveBeenCalled());

    expect(page['skillPanelTab']).toBe('local');
    expect(page['skillCategoryFilter']).toBe(CATEGORY_ALL);
    expect(page['skillPanelFocus']).toEqual({ key: 'local:weather.wttr' });
  });
});
