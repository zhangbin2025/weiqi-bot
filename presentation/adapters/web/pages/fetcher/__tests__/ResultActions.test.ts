/**
 * 端到端验证：结果卡片操作区渲染（首要动作 + 三点菜单）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetcherRenderer } from '../FetcherRenderer';
import { FetcherFormatter, type ResultActionsInput } from '../FetcherFormatter';
import { WebAdapterFactory } from '../../../WebAdapterFactory';
import type { FetcherResult } from '../../../../../../application/fetcher';
import { classifyGame, type GameClassification, type GameAction } from '../utils/gameKind';

function makeResult(over: Partial<FetcherResult> & { source: string }): FetcherResult {
  return {
    success: true,
    archiveId: 'arch-1',
    url: 'https://example.com/g/1',
    fromCache: false,
    metadata: { black: '柯洁', white: '申真谞', date: '2026-10-13', movesCount: 210 },
    ...over,
  } as FetcherResult;
}

/** 与 FetcherPage.buildResultActions 同逻辑：首要动作为大按钮，次动作并排，第三个是「更多」 */
function buildActions(cls: GameClassification, externalUrl?: string): ResultActionsInput {
  const primary: GameAction = cls.primary;
  const secondary = cls.actions.find((a) => a !== primary && a !== 'share') ?? null;
  return { primary, secondary, actions: cls.actions, externalUrl };
}

function classify(r: FetcherResult): GameClassification {
  return classifyGame({
    source: r.source,
    url: r.url,
    isLive: r.metadata?.isLive,
    isEnded: r.metadata?.isEnded,
  });
}

describe('结果卡片操作区', () => {
  let renderer: FetcherRenderer;

  beforeEach(() => {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    document.body.appendChild(root);
    const factory = new WebAdapterFactory();
    factory.setRootContainer(root);
    renderer = new FetcherRenderer({
      onFetch: vi.fn(), onViewBookmark: vi.fn(), onClearBookmarks: vi.fn(),
      onDownload: vi.fn(), onViewSGF: vi.fn(), onLive: vi.fn(),
      onGenerateShareUrl: vi.fn(), onSelectLatestView: vi.fn(), onFetchLatest: vi.fn(),
      onSelectLatest: vi.fn(), onViewUrl: vi.fn(),
    } as any, factory as any, new FetcherFormatter());
    renderer.initialize();
    renderer.bindActions();
  });

  function render(result: FetcherResult): HTMLElement {
    renderer.showResult(result, buildActions(classify(result)));
    return (renderer as any).resultCard.getContainer() as HTMLElement;
  }

  it('死活题：首要动作是做题，不再有右上角三点按钮', () => {
    const c = render(makeResult({ source: 'lib-life-death', url: 'lib://life-and-death/2026-10-13/0' }));
    expect(c.innerHTML).toContain('🧩 做题');
    expect(c.querySelector('.result-dots')).toBeNull();
    expect(c.querySelector('.result-more')).toBeTruthy();
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    expect(tpl.innerHTML).toContain('复盘');
  });

  it('内置库链接（lib://）不显示「查看链接」', () => {
    const c = render(makeResult({ source: 'lib-life-death', url: 'lib://life-and-death/2026-10-13/0' }));
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    expect(tpl.querySelector('[data-action="viewUrl"]')).toBeNull();
  });

  it('直播棋谱：首要动作是直播', () => {
    const c = render(makeResult({
      source: 'ogs-live', url: 'https://online-go.com/game/1',
      metadata: { black: 'A', white: 'B', date: '2026-10-13', movesCount: 50, isLive: true } as any,
    }));
    expect(c.innerHTML).toContain('🔴 直播');
    expect(c.querySelector('.result-dots')).toBeNull();
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    expect(tpl.innerHTML).toContain('发现定式');
  });

  it('带 AI 标注：首要动作是实战选点', () => {
    const c = render(makeResult({ source: 'lib-ai-review', url: 'lib://ai-review/2026-10-13/0' }));
    expect(c.innerHTML).toContain('🎯 实战选点');
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    expect(tpl.innerHTML).toContain('复盘');
    expect(tpl.innerHTML).toContain('发现定式');
  });

  it('扩展菜单不与按钮行重复：首要动作「实战选点」不出现在菜单里', () => {
    const c = render(makeResult({ source: 'lib-ai-review', url: 'lib://ai-review/2026-10-13/0' }));
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    // 首要动作（实战选点）与次要动作（查看）都在按钮行上，菜单里不应重复
    expect(tpl.querySelector('[data-action="decision"]')).toBeNull();
    expect(tpl.querySelector('[data-action="view"]')).toBeNull();
    // 其余动作仍在菜单里，且包含分享
    expect(tpl.querySelector('[data-action="review"]')).toBeTruthy();
    expect(tpl.querySelector('[data-action="joseki"]')).toBeTruthy();
    expect(tpl.querySelector('[data-action="download"]')).toBeTruthy();
    expect(tpl.querySelector('[data-action="share"]')).toBeTruthy();
  });

  it('第三个按钮是「更多 ⋯」，本身就是菜单开关', () => {
    const c = render(makeResult({ source: 'foxwq' }));
    const more = c.querySelector('.result-more') as HTMLElement;
    expect(more).toBeTruthy();
    expect(more.textContent).toContain('更多');
    expect(more.getAttribute('data-action')).toBe('openResultMenu');
  });

  it('一般棋谱：首要动作是查看（打谱）', () => {
    const c = render(makeResult({ source: 'foxwq' }));
    expect(c.innerHTML).toContain('👁️ 查看');
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    // 查看/复盘 已上按钮行，菜单里只剩发现定式/下载/分享
    expect(tpl.innerHTML).toContain('发现定式');
    expect(tpl.innerHTML).toContain('下载');
    expect(tpl.innerHTML).toContain('分享');
    expect(tpl.querySelector('[data-action="view"]')).toBeNull();
    expect(tpl.querySelector('[data-action="review"]')).toBeNull();
    expect(tpl.innerHTML).not.toContain('实战选点');
  });

  it('点击「更多」按钮展开菜单，菜单项动作名正确，再点关闭', () => {
    const c = render(makeResult({ source: 'foxwq' }));
    (c.querySelector('.result-more') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const menu = c.querySelector('div[data-menu]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.querySelector('[data-action="joseki"]')).toBeTruthy();
    expect(menu.querySelector('[data-action="download"]')).toBeTruthy();
    expect(menu.querySelector('[data-action="share"]')).toBeTruthy();
    (c.querySelector('.result-more') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(c.querySelector('div[data-menu]')).toBeNull();
  });

  it('外链为 http(s) 时菜单含「查看链接」，内置库伪协议时不含', () => {
    // http(s)：显示「查看链接」
    const httpUrl = 'https://example.com/g/1';
    renderer.showResult(makeResult({ source: 'foxwq', url: httpUrl }),
      buildActions(classifyGame({ source: 'foxwq', url: httpUrl }), httpUrl));
    const httpCard = (renderer as any).resultCard.getContainer() as HTMLElement;
    expect(httpCard.querySelector('[data-menu-template] [data-action="viewUrl"]')).toBeTruthy();

    // 内置库：lib:// 不是 http(s)，不显示「查看链接」
    const libUrl = 'lib://ai-review/2026-10-13/0';
    renderer.showResult(makeResult({ source: 'lib-ai-review', url: libUrl }),
      buildActions(classifyGame({ source: 'lib-ai-review', url: libUrl }), libUrl));
    const lib = (renderer as any).resultCard.getContainer() as HTMLElement;
    expect(lib.querySelector('[data-menu-template] [data-action="viewUrl"]')).toBeNull();
  });

  it('分类升级时 updateResultActions 只换操作区', () => {
    const r = makeResult({ source: 'foxwq' });
    const c = render(r);
    const before = c.querySelector('[data-action="view"]');
    expect(before).toBeTruthy();
    // 模拟拿到 SGF 后发现 AI 标注：类别从 plain 升到 ai-review
    const upgraded = classifyGame({ source: 'foxwq', url: r.url, sgf: '(;SZ[19];B[pd]C[胜率: 36.1%])' });
    expect(upgraded.kind).toBe('ai-review');
    renderer.updateResultActions(buildActions(upgraded));
    const after = c.querySelector('[data-action="decision"]');
    expect(after).toBeTruthy();
  });
});
