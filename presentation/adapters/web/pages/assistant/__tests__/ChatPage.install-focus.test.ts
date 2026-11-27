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
  // 依赖插件闸门：散文配方（recipe 无 workflow）零依赖 → plan 返回空动作、不弹框。
  page['skillPluginInstaller'] = {
    plan: vi.fn(async () => ({ resourceIds: [], actions: [], blockers: [], installEntries: new Map() })),
    apply: vi.fn(async () => ({ ok: true, message: '依赖插件均已满足', installed: [], enabled: [], failures: [] })),
  };
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

// ---------- 装技能时自动装/启用依赖插件（2026-11-25） ----------

/** 带 workflow、引用插件算子的配方：call 里第一个点前是插件 slug */
const pluginRecipe: SkillRecipe = {
  ...recipe,
  id: 'circle.foxwq',
  name: '弈友圈',
  primitives: [],
  workflow: { steps: [
    { id: 'fetch', call: 'foxwq.fetchBatch' },
    { id: 'norm', call: 'circle.normalize' },
  ] },
};

function pluginSkillItem(): SkillBrowseItem {
  return { recipe: pluginRecipe, state: 'new' };
}

function fakeAction(overrides: Partial<{
  resourceId: string; slug: string; name: string; kind: 'install' | 'update' | 'enable'; artifactId: string;
}> = {}) {
  return {
    resourceId: 'workflow-operator.circle', slug: 'circle', name: '弈友圈关系算子',
    kind: 'install' as const, ...overrides,
  };
}

describe('技能依赖插件：装前确认 + 自动安装/启用', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  /** 点安装按钮并等刷新被调用；返回页面对象供断言 */
  async function installAndFlush(
    page: ReturnType<typeof makePage>, install: ReturnType<typeof vi.fn>,
  ): Promise<void> {
    const card = (page['buildOnlineSkillCard'] as (
      i: SkillBrowseItem, s: SkillSource, c: SkillCatalogService,
    ) => HTMLElement).call(page, pluginSkillItem(), skillSource, fakeSkillCatalog(install));
    await clickAndFlush(findButton(card, '安装'), page['refreshSkillPanel'] as ReturnType<typeof vi.fn>);
  }

  it('无插件依赖（plan 零动作）：不弹框、直接装技能', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({ ok: true, action: 'installed', message: '已安装。' }));
    const dialog = vi.fn(async () => true);
    page['openSkillPluginConfirmDialog'] = dialog;
    await installAndFlush(page, install);
    expect(page['skillPluginInstaller'].plan).toHaveBeenCalledWith(pluginRecipe);
    expect(dialog).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledTimes(1);
    expect(page['skillPanelTab']).toBe('local');
    expect(page['skillPanelFocus']).toEqual({ key: 'local:circle.foxwq' });
  });

  it('有依赖 → 弹框列出将安装启用的插件；取消 = 放弃整次技能安装', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({ ok: true, action: 'installed', message: '已安装。' }));
    const actions = [fakeAction(), fakeAction({ resourceId: 'workflow-operator.calendar', slug: 'calendar', name: '日历算子', kind: 'enable', artifactId: 'art-cal' })];
    (page['skillPluginInstaller'].plan as ReturnType<typeof vi.fn>).mockResolvedValue({
      resourceIds: actions.map((a) => a.resourceId), actions, blockers: [], installEntries: new Map(),
    });
    // 取消：弹框 resolve(false)
    page['openSkillPluginConfirmDialog'] = vi.fn(async () => false);
    await installAndFlush(page, install);
    const dialog = page['openSkillPluginConfirmDialog'] as ReturnType<typeof vi.fn>;
    expect(dialog).toHaveBeenCalledWith('弈友圈', actions);
    expect(page['skillPluginInstaller'].apply).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(page['skillPanelTab']).toBe('online');
    expect(page['skillPanelFocus']).toBeUndefined();
    expect(page['skillPanelFlash']).toEqual({ text: expect.stringContaining('已放弃安装技能'), error: false });
  });

  it('确认 → 先 apply 安装/启用插件、刷新算子表，再装技能', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({ ok: true, action: 'installed', message: '已安装。' }));
    const actions = [fakeAction(), fakeAction({ resourceId: 'workflow-operator.calendar', slug: 'calendar', name: '日历算子', kind: 'enable', artifactId: 'art-cal' })];
    const apply = vi.fn(async () => ({
      ok: true, message: '依赖插件处理：已启用 弈友圈关系算子、日历算子。',
      installed: ['弈友圈关系算子'], enabled: ['弈友圈关系算子', '日历算子'], failures: [],
    }));
    (page['skillPluginInstaller'].plan as ReturnType<typeof vi.fn>).mockResolvedValue({
      resourceIds: actions.map((a) => a.resourceId), actions, blockers: [], installEntries: new Map(),
    });
    page['skillPluginInstaller'].apply = apply;
    page['openSkillPluginConfirmDialog'] = vi.fn(async () => true);
    await installAndFlush(page, install);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(page['refreshOperatorRegistry']).toHaveBeenCalled();
    expect(install).toHaveBeenCalledTimes(1);
    expect(page['skillPanelTab']).toBe('local');
    expect(page['skillPanelFocus']).toEqual({ key: 'local:circle.foxwq' });
    expect(page['skillPanelFlash']).toEqual({
      text: expect.stringContaining('依赖插件处理'), error: false,
    });
    expect(page['skillPanelFlash']).toEqual({ text: expect.stringContaining('已安装。'), error: false });
  });

  it('blockers（在线源找不到依赖）：不弹框、放弃装技能、中文提示', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({ ok: true, action: 'installed', message: '已安装。' }));
    (page['skillPluginInstaller'].plan as ReturnType<typeof vi.fn>).mockResolvedValue({
      resourceIds: ['workflow-operator.circle'], actions: [],
      blockers: ['在线插件源里找不到依赖插件 workflow-operator.circle'], installEntries: new Map(),
    });
    page['openSkillPluginConfirmDialog'] = vi.fn(async () => true);
    await installAndFlush(page, install);
    expect(page['openSkillPluginConfirmDialog']).not.toHaveBeenCalled();
    expect(page['skillPluginInstaller'].apply).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(page['skillPanelFlash']).toEqual({
      text: expect.stringContaining('找不到依赖插件'), error: true,
    });
  });

  it('apply 失败：放弃装技能，不定位本地条目', async () => {
    const page = makePage();
    const install = vi.fn(async () => ({ ok: true, action: 'installed', message: '已安装。' }));
    const actions = [fakeAction()];
    (page['skillPluginInstaller'].plan as ReturnType<typeof vi.fn>).mockResolvedValue({
      resourceIds: actions.map((a) => a.resourceId), actions, blockers: [], installEntries: new Map(),
    });
    page['skillPluginInstaller'].apply = vi.fn(async () => ({
      ok: false, message: '依赖插件处理：失败：xxx。', installed: [], enabled: [], failures: ['xxx'],
    }));
    page['openSkillPluginConfirmDialog'] = vi.fn(async () => true);
    await installAndFlush(page, install);
    expect(install).not.toHaveBeenCalled();
    expect(page['skillPanelTab']).toBe('online');
    expect(page['skillPanelFocus']).toBeUndefined();
    expect(page['skillPanelFlash']).toEqual({ text: expect.stringContaining('已放弃安装技能'), error: true });
  });
});

describe('依赖插件确认弹框：真实 DOM 交互', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  /** 直接调私有的自建 overlay 弹框（不 mock），返回 Promise 与页面对象 */
  function openDialog(page: ReturnType<typeof makePage>) {
    const actions = [fakeAction(), fakeAction({
      resourceId: 'workflow-operator.calendar', slug: 'calendar',
      name: '日历算子', kind: 'enable', artifactId: 'art-cal',
    })];
    const promise = (page['openSkillPluginConfirmDialog'] as (
      n: string, a: unknown[],
    ) => Promise<boolean>).call(page, '弈友圈', actions);
    const overlay = document.getElementById('skillPluginConfirmOverlay')!;
    return { promise, overlay };
  }

  function btn(overlay: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(overlay.querySelectorAll('button'))
      .find((b) => b.textContent === label);
    if (!found) throw new Error(`弹框里找不到「${label}」按钮`);
    return found;
  }

  it('列出将安装 / 启用的插件名与动作，动态文本走 textContent（含特殊字符不解释）', async () => {
    const page = makePage();
    const { promise, overlay } = openDialog(page);
    const text = overlay.textContent ?? '';
    expect(text).toContain('弈友圈关系算子');
    expect(text).toContain('workflow-operator.circle');
    expect(text).toContain('安装并启用');
    expect(text).toContain('日历算子');
    expect(text).toContain('启用（已安装、当前停用）');
    // 没有 innerHTML 拼接的痕迹：用带 HTML 的名字再开一次
    btn(overlay, '放弃安装技能').click();
    expect(await promise).toBe(false);
    const special = `<img src=x onerror=alert(1)>`;
    const p2 = (page['openSkillPluginConfirmDialog'] as (
      n: string, a: unknown[],
    ) => Promise<boolean>).call(page, 'X', [{ ...fakeAction(), name: special }]);
    const o2 = document.getElementById('skillPluginConfirmOverlay')!;
    expect(o2.querySelector('img')).toBeNull();
    expect(o2.textContent).toContain(special);
    btn(o2, '放弃安装技能').click();
    expect(await p2).toBe(false);
  });

  it('点「确认安装」→ true；取消 / 遮罩 / Esc → false 且 overlay 移除', async () => {
    const page = makePage();
    // 确认
    {
      const { promise, overlay } = openDialog(page);
      btn(overlay, '确认安装（技能 + 依赖插件）').click();
      expect(await promise).toBe(true);
      expect(document.getElementById('skillPluginConfirmOverlay')).toBeNull();
    }
    // 取消
    {
      const { promise, overlay } = openDialog(page);
      btn(overlay, '放弃安装技能').click();
      expect(await promise).toBe(false);
      expect(document.getElementById('skillPluginConfirmOverlay')).toBeNull();
    }
    // 点遮罩
    {
      const { promise, overlay } = openDialog(page);
      overlay.click();
      expect(await promise).toBe(false);
    }
    // Esc
    {
      const { promise } = openDialog(page);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(await promise).toBe(false);
    }
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
