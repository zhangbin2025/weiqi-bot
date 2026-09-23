/**
 * FetcherRenderer 最新列表本地切片分页测试
 * 覆盖：默认展示 10 盘、滑到底异步追加 10 盘（带"加载中"体感）、到底停止
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetcherRenderer } from '../FetcherRenderer';
import { FetcherFormatter } from '../FetcherFormatter';
import { WebAdapterFactory } from '../../../WebAdapterFactory';

/** 支持手动触发回调的 IntersectionObserver mock（不会自动触发 intersecting） */
class MockIO {
  static instances: MockIO[] = [];
  elements: Element[] = [];
  private _cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this._cb = cb;
    MockIO.instances.push(this);
  }
  observe(el: Element) { this.elements.push(el); }
  unobserve() {}
  disconnect() { this.elements = []; }
  takeRecords() { return []; }
  /** 模拟"滑到底"：触发进入视口回调 */
  trigger() {
    this._cb(this.elements.map((target) => ({ target, isIntersecting: true })) as any, this as any);
  }
}

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    source: 'foxwq',
    title: `对局${i + 1}`,
    date: '09-20',
    url: `https://example.com/g${i + 1}`,
  }));
}

describe('FetcherRenderer 最新列表本地切片（默认10/滑到底+10 异步）', () => {
  let renderer: FetcherRenderer;
  let root: HTMLElement;
  const DELAY = FetcherRenderer.LATEST_LOAD_DELAY;

  beforeEach(() => {
    document.body.innerHTML = '';
    MockIO.instances = [];
    (globalThis as any).IntersectionObserver = MockIO;
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.appendChild(root);
    const factory = new WebAdapterFactory();
    factory.setRootContainer(root);
    renderer = new FetcherRenderer(
      {
        onFetch: vi.fn(), onViewBookmark: vi.fn(), onClearBookmarks: vi.fn(),
        onDownload: vi.fn(), onViewSGF: vi.fn(), onLive: vi.fn(),
        onGenerateShareUrl: vi.fn(), onSelectLatestView: vi.fn(),
        onFetchLatest: vi.fn(), onSelectLatest: vi.fn(), onViewUrl: vi.fn(),
      } as any,
      factory as any,
      new FetcherFormatter(),
    );
    renderer.initialize();
    renderer.bindLatestActions();
  });

  function container(): HTMLElement {
    return (renderer as any).latestCard.getContainer() as HTMLElement;
  }
  function itemCount(): number {
    return container().querySelectorAll(':scope > div[data-action="selectLatest"]').length;
  }
  function hasSpinner(): boolean {
    return !!container().querySelector('[data-latest-loading]');
  }
  /** 触发一次"滑到底"并完成下一页加载（推进定时器） */
  function loadMoreOnce(): void {
    MockIO.instances.at(-1)!.trigger();
    vi.advanceTimersByTime(DELAY + 50);
  }

  it('默认只展示前 10 盘', () => {
    renderer.renderLatestGames(makeItems(100));
    expect(itemCount()).toBe(10);
    expect(renderer.getLatestDisplayed()).toBe(10);
  });

  it('滑到底先显示"加载中"，完成后追加 10 盘', () => {
    renderer.renderLatestGames(makeItems(100));
    expect(itemCount()).toBe(10);
    // 触发滑到底：此时应出现加载中 spinner，且列表尚未增长
    MockIO.instances.at(-1)!.trigger();
    expect(hasSpinner()).toBe(true);
    expect(itemCount()).toBe(10);
    // 推进定时器：加载完成，spinner 消失，追加 10 盘
    vi.advanceTimersByTime(DELAY + 50);
    expect(hasSpinner()).toBe(false);
    expect(itemCount()).toBe(20);
    expect(renderer.getLatestDisplayed()).toBe(20);
  });

  it('连续滑到底逐步累加，且不超过池子大小（100）', () => {
    renderer.renderLatestGames(makeItems(100));
    for (let i = 0; i < 10; i++) loadMoreOnce();
    expect(itemCount()).toBe(100);
    expect(renderer.getLatestDisplayed()).toBe(100);
  });

  it('达到池子末尾后到底停止（不增长、无 spinner、不再新建 observer）', () => {
    renderer.renderLatestGames(makeItems(12));
    loadMoreOnce(); // 10 -> 12
    expect(itemCount()).toBe(12);
    const before = MockIO.instances.length;
    // 已到底，再触发不应增长
    MockIO.instances.at(-1)!.trigger();
    vi.advanceTimersByTime(DELAY + 50);
    expect(itemCount()).toBe(12);
    expect(MockIO.instances.length).toBe(before);
    expect(hasSpinner()).toBe(false);
  });

  it('新查询重置为默认 10 盘', () => {
    renderer.renderLatestGames(makeItems(100));
    loadMoreOnce();
    expect(itemCount()).toBe(20);
    renderer.renderLatestGames(makeItems(40));
    expect(itemCount()).toBe(10);
  });

  it('无 IntersectionObserver 环境降级为全量展示', () => {
    (globalThis as any).IntersectionObserver = undefined;
    renderer.renderLatestGames(makeItems(30));
    expect(itemCount()).toBe(30);
  });
});
