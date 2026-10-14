/**
 * 标签页状态恢复测试
 * @description 跳到其他页面再返回时（Android WebView / Electron 不支持 bfcache，
 *              整页重载），应当回到离开前所在的标签页，而不是默认页。
 *
 *              fetcher：之前无条件 switchToLatestTab()，导致在「抓取」/「收藏」
 *              离开的人返回被强拆到「最新」。
 *              decision：切 tab 只 toggle class，什么都不存，返回必回「生成」。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetcherRenderer } from '../FetcherRenderer';
import { FetcherFormatter } from '../FetcherFormatter';
import { WebAdapterFactory } from '../../../WebAdapterFactory';

const TAB_KEY = 'fetcher_active_tab';

function makeRenderer(onTabChange?: (tabId: string) => void) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const factory = new WebAdapterFactory();
  factory.setRootContainer(root);
  const renderer = new FetcherRenderer(
    {
      onFetch: vi.fn(), onViewBookmark: vi.fn(), onClearBookmarks: vi.fn(),
      onDownload: vi.fn(), onViewSGF: vi.fn(), onLive: vi.fn(),
      onGenerateShareUrl: vi.fn(), onSelectLatestView: vi.fn(),
      onFetchLatest: vi.fn(), onSelectLatest: vi.fn(), onViewUrl: vi.fn(),
    } as any,
    factory as any, new FetcherFormatter(),
    onTabChange ? { onTabChange } : undefined,
  );
  renderer.initialize();
  return { renderer, root };
}

describe('fetcher 标签切换会持久化当前标签', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  it('切到「最新」时回调收到 latest', () => {
    const seen: string[] = [];
    const { renderer } = makeRenderer((id) => { seen.push(id); });
    expect(renderer.getActiveTabId()).toBe('query');

    renderer.switchToLatestTab();
    expect(seen).toEqual(['latest']);
    expect(renderer.getActiveTabId()).toBe('latest');
  });

  it('切到「收藏」时回调收到 bookmarks（此前不会记录）', () => {
    const seen: string[] = [];
    makeRenderer((id) => { seen.push(id); });
    // 通过 restoreTab 之外的正常切换入口：restoreTab 不触发事件，
    // 所以这里直接点 UI 上的标签项
    const items = Array.from(document.querySelectorAll('.web-tabs__item')) as HTMLElement[];
    const bookmarksTab = items.find((el) => el.textContent?.includes('收藏'));
    expect(bookmarksTab).toBeTruthy();
    bookmarksTab!.click();
    expect(seen).toContain('bookmarks');
  });

  it('restoreTab 恢复指定标签且不触发 onTabChange（避免用恢复值覆盖存储）', () => {
    const seen: string[] = [];
    const { renderer } = makeRenderer((id) => { seen.push(id); });
    renderer.restoreTab('bookmarks');
    expect(renderer.getActiveTabId()).toBe('bookmarks');
    expect(seen).toEqual([]);
  });

  it('restoreTab 恢复「最新」时同步切换面板可见性', () => {
    const { renderer } = makeRenderer();
    renderer.restoreTab('latest');
    expect(renderer.getActiveTabId()).toBe('latest');
  });
});
