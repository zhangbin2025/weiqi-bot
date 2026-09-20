/**
 * FetcherRenderer 最新列表三点扩展菜单 DOM 测试（使用真实 WebAdapterFactory）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetcherRenderer } from '../FetcherRenderer';
import { FetcherFormatter } from '../FetcherFormatter';
import { WebAdapterFactory } from '../../../WebAdapterFactory';

describe('FetcherRenderer 三点菜单（真实 DOM）', () => {
  let renderer: FetcherRenderer;
  let root: HTMLElement;
  let latestActionCb: ((action: string, data?: Record<string, string>) => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    const factory = new WebAdapterFactory();
    factory.setRootContainer(root);

    const origCreateCard = factory.createCard.bind(factory);
    factory.createCard = ((container?: unknown) => {
      const card = origCreateCard(container) as any;
      const origOnAction = card.onAction.bind(card);
      card.onAction = (cb: any) => { latestActionCb = cb; origOnAction(cb); };
      return card;
    }) as any;

    renderer = new FetcherRenderer(
      { onFetch: vi.fn(), onViewBookmark: vi.fn(), onClearBookmarks: vi.fn(),
        onDownload: vi.fn(), onViewSGF: vi.fn(), onLive: vi.fn(),
        onGenerateShareUrl: vi.fn(), onSelectLatestView: vi.fn(),
        onFetchLatest: vi.fn(), onSelectLatest: vi.fn(), onViewUrl: vi.fn() } as any,
      factory as any, new FetcherFormatter(),
    );
    renderer.initialize();
    renderer.bindLatestActions();
  });

  function latestContainer(): HTMLElement {
    return (renderer as any).latestCard.getContainer() as HTMLElement;
  }

  it('每条目右上角有三点按钮和隐藏菜单模板', () => {
    renderer.renderLatestGames([
      { source: 'foxwq', title: '对局A', date: '09-20', url: 'https://example.com/a' },
      { source: 'ogs-live', title: '直播B', date: '09-20', url: 'https://example.com/b' },
    ]);
    const c = latestContainer();
    expect(c.querySelectorAll(':scope > div[data-action="selectLatest"]').length).toBe(2);
    expect(c.querySelectorAll('.latest-dots').length).toBe(2);
    expect(c.querySelectorAll('[data-menu-template]').length).toBe(2);
  });

  it('直播条目菜单含 查看棋谱+直播棋谱+查看链接；普通条目仅 查看链接', () => {
    renderer.renderLatestGames([
      { source: 'foxwq', title: '对局A', date: '09-20', url: 'https://example.com/a' },
      { source: 'ogs-live', title: '直播B', date: '09-20', url: 'https://example.com/b' },
    ]);
    const c = latestContainer();
    const tpls = c.querySelectorAll('[data-menu-template]');
    const normalMenu = tpls[0].innerHTML;
    const liveMenu = tpls[1].innerHTML;
    expect(normalMenu).toContain('查看链接');
    expect(normalMenu).not.toContain('直播棋谱');
    expect(liveMenu).toContain('查看棋谱');
    expect(liveMenu).toContain('直播棋谱');
    expect(liveMenu).toContain('查看链接');
  });

  it('点击三点按钮打开菜单，再次点击关闭，且菜单互斥', () => {
    renderer.renderLatestGames([
      { source: 'foxwq', title: '对局A', date: '09-20', url: 'https://example.com/a' },
      { source: 'foxwq', title: '对局C', date: '09-20', url: 'https://example.com/c' },
    ]);
    const c = latestContainer();
    const dots = c.querySelectorAll('.latest-dots');
    (dots[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(c.querySelectorAll('div[data-menu]').length).toBe(1);
    (dots[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(c.querySelectorAll('div[data-menu]').length).toBe(1);
    (dots[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(c.querySelectorAll('div[data-menu]').length).toBe(0);
  });

  it('点击 查看链接 通过 latestCard.onAction 触发 viewUrl 回调', () => {
    renderer.renderLatestGames([
      { source: 'foxwq', title: '对局A', date: '09-20', url: 'https://example.com/a' },
    ]);
    const c = latestContainer();
    (c.querySelector('.latest-dots') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const menu = c.querySelector('div[data-menu]') as HTMLElement;
    const link = menu.querySelector('[data-action="viewUrl"]') as HTMLElement;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(latestActionCb).toBeDefined();
    latestActionCb!('viewUrl', { url: 'https://example.com/a' });
  });

  it('katago 条目"查看链接"指向归档压缩包 externalUrl', () => {
    renderer.renderLatestGames([
      { source: 'katago', title: '#1', subtitle: 'hash1', date: '2026-09-14',
        url: 'katago://date/2026-09-14/0',
        externalUrl: 'https://katagoarchive.org/kata1/ratinggames/2026-09-14rating.tar.bz2' },
    ]);
    const c = latestContainer();
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    const link = tpl.querySelector('[data-action="viewUrl"]') as HTMLElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('data-url'))
      .toBe('https://katagoarchive.org/kata1/ratinggames/2026-09-14rating.tar.bz2');
  });

  it('katago 伪协议且无 externalUrl 时不显示"查看链接"', () => {
    renderer.renderLatestGames([
      { source: 'katago', title: '#1', date: '2026-09-14', url: 'katago://date/2026-09-14/0' },
    ]);
    const c = latestContainer();
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    expect(tpl.querySelector('[data-action="viewUrl"]')).toBeNull();
  });

  it('goproblems 列表项 URL 为 /problems/<id> 形式（回归）', () => {
    renderer.renderLatestGames([
      { source: 'goproblems', title: 'GP-62692', date: '2026-09-01',
        url: 'https://goproblems.com/problems/62692' },
    ]);
    const c = latestContainer();
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    const link = tpl.querySelector('[data-action="viewUrl"]') as HTMLElement;
    expect(link.getAttribute('data-url')).toBe('https://goproblems.com/problems/62692');
  });
});
