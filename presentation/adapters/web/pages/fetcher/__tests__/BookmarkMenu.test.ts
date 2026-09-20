/**
 * 收藏列表条目三点扩展菜单 DOM 测试（与"最新"标签页统一样式）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetcherRenderer } from '../FetcherRenderer';
import { FetcherFormatter } from '../FetcherFormatter';
import { WebAdapterFactory } from '../../../WebAdapterFactory';

describe('FetcherRenderer 收藏三点菜单（真实 DOM）', () => {
  let renderer: FetcherRenderer;
  let root: HTMLElement;
  let bookmarkCb: ((action: string, data?: Record<string, string>) => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    const factory = new WebAdapterFactory();
    factory.setRootContainer(root);

    const origCreateCard = factory.createCard.bind(factory);
    let cardCount = 0;
    factory.createCard = ((container?: unknown) => {
      const card = origCreateCard(container) as any;
      // 第 2 个 card 是 bookmarkCard（顺序：resultCard? queryPanel? ...）——用回调捕获
      const origOnAction = card.onAction.bind(card);
      card.onAction = (cb: any) => { 
        // 同时记录 latest 与 bookmark 回调；通过 action 名区分
        origOnAction((action: string, data?: any) => {
          if (action === 'openBookmarkMenu' || action === 'viewBookmark') bookmarkCb = cb;
          cb(action, data);
        });
        card._cb = cb;
      };
      cardCount++;
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
    renderer.bindActions();
  });

  function bookmarkContainer(): HTMLElement {
    return (renderer as any).bookmarkCard.getContainer() as HTMLElement;
  }

  const archived = { id: 'b1', url: 'https://www.foxwq.com/qipu/1', archiveId: 'arch1',
    source: 'foxwq', black: '柯洁', white: '申真谞', result: 'B+R', date: '2026-09-01',
    movesCount: 210, updatedAt: Date.now() };

  it('每个收藏条目有右上角三点按钮与菜单模板，含 打开收藏 + 查看链接；日期为抓取时间且只含年月日', () => {
    renderer.renderBookmarks([archived as any]);
    const c = bookmarkContainer();
    expect(c.querySelectorAll('.bookmark-dots').length).toBe(1);
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    expect(tpl).toBeTruthy();
    expect(tpl.innerHTML).toContain('打开收藏');
    expect(tpl.innerHTML).toContain('查看链接');
    // 归档棋谱样式：黑 vs 白 + 结果手数
    expect(c.innerHTML).toContain('柯洁');
    expect(c.innerHTML).toContain('申真谞');
    expect(c.innerHTML).toContain('210手');
    // 日期为抓取时间且只含年月日（无"未知时间"、无时分秒）
    expect(c.innerHTML).not.toContain('未知时间');
    expect(c.innerHTML).toContain('2026-09-01');
    expect(c.innerHTML).not.toMatch(/2026-09-01\s+\d{1,2}:/);  // 不含时分
  });

  it('死活题收藏副标题含主线分支手数', () => {
    renderer.renderBookmarks([
      Object.assign({}, archived, { id: 'bp', source: 'goproblems', movesCount: 12 }) as any,
    ]);
    const c = bookmarkContainer();
    expect(c.innerHTML).toContain('死活题');
    expect(c.innerHTML).toContain('12手');
  });

  it('直播来源收藏菜单额外含 查看棋谱/直播棋谱', () => {
    renderer.renderBookmarks([
      Object.assign({}, archived, { id: 'b2', source: 'ogs-live', url: 'https://online-go.com/game/1' }) as any,
    ]);
    const c = bookmarkContainer();
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    expect(tpl.innerHTML).toContain('查看棋谱');
    expect(tpl.innerHTML).toContain('直播棋谱');
    expect(tpl.innerHTML).toContain('打开收藏');
  });

  it('katago 收藏的"查看链接"指向归档压缩包', () => {
    renderer.renderBookmarks([
      Object.assign({}, archived, { id: 'b3', source: 'katago', url: 'katago://date/2026-09-14/0' }) as any,
    ]);
    const c = bookmarkContainer();
    const tpl = c.querySelector('[data-menu-template]') as HTMLElement;
    const link = tpl.querySelector('[data-action="viewUrl"]') as HTMLElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('data-url')).toBe('https://katagoarchive.org/kata1/ratinggames/2026-09-14rating.tar.bz2');
  });

  it('点击三点按钮打开菜单，再次点击关闭，且互斥', () => {
    renderer.renderBookmarks([
      archived as any,
      Object.assign({}, archived, { id: 'b4' }) as any,
    ]);
    const c = bookmarkContainer();
    const dots = c.querySelectorAll('.bookmark-dots');
    (dots[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(c.querySelectorAll('div[data-menu]').length).toBe(1);
    (dots[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(c.querySelectorAll('div[data-menu]').length).toBe(1);
    (dots[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(c.querySelectorAll('div[data-menu]').length).toBe(0);
  });

  it('点击卡片主体触发 viewBookmark（保留原打开收藏行为）', () => {
    renderer.renderBookmarks([archived as any]);
    const c = bookmarkContainer();
    const card = c.querySelector('[data-action="viewBookmark"][data-id="b1"]') as HTMLElement;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bookmarkCb).toBeDefined();
  });
});
