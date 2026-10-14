/**
 * fetcher 恢复路径集成测试（模拟 Android GeckoView：返回 = 整页重载）
 * @description 复现 index.ts 的真实启动顺序：initialize() 后再 handleParams()。
 *              Android 返回会整页重载并重跑这段，纯 web 靠 bfcache 不会重跑。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetcherPage } from '../FetcherPage';
import { WebAdapterFactory } from '../../../WebAdapterFactory';

function makeApp() {
  return {
    fetch: vi.fn().mockResolvedValue({ success: true, archiveId: 'a1', source: 'foxwq', url: 'https://x/1', metadata: {} }),
    getBookmarks: vi.fn().mockResolvedValue([]),
    fetchLatestGames: vi.fn().mockResolvedValue([
      { url: 'https://x/1', black: 'A', white: 'B', date: '2026-10-14' },
    ]),
    getArchiveContent: vi.fn().mockResolvedValue(undefined),
  } as any;
}

/** 完整复刻 clients/web/fetcher/index.ts 的启动顺序 */
async function boot(search: string) {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  root.id = 'page-root';
  document.body.appendChild(root);
  const factory = new WebAdapterFactory();
  factory.setRootContainer(root);
  const page = new FetcherPage({ fetcherApp: makeApp(), adapterFactory: factory });

  await page.initialize();                       // ① 恢复（含标签）

  const urlParams = new URLSearchParams(search); // ② 复刻 index.ts
  const auto = urlParams.get('auto');
  const params: Record<string, string> = {};
  urlParams.forEach((v, k) => { if (k !== 'auto') params[k] = v; });
  if (auto === 'true' && Object.keys(params).length > 0) {
    await page.handleParams(params);
    window.history.replaceState({}, '', window.location.pathname);
  } else if (Object.keys(params).length > 0) {
    await page.handleParams(params);             // ⚠️ 不清理 URL
  }
  page.render();
  return { page, root };
}

const clickTab = (root: HTMLElement, label: string) => {
  const items = Array.from(root.querySelectorAll('.web-tabs__item')) as HTMLElement[];
  const el = items.find((e) => e.textContent?.includes(label));
  if (!el) throw new Error('tab not found: ' + label);
  el.click();
};
const active = (page: any) => page.renderer.getActiveTabId();

describe('fetcher 整页重载后恢复标签', () => {
  beforeEach(() => { document.body.innerHTML = ''; sessionStorage.clear(); });

  it('无参数：切「最新」→ 重载后仍在「最新」', async () => {
    const { root } = await boot('');
    clickTab(root, '最新');
    const { page } = await boot('');
    expect(active(page)).toBe('latest');
  });

  it('带残留参数（如 taskId）：切「最新」→ 重载后应仍在「最新」', async () => {
    const { root, page: p1 } = await boot('?taskId=t1');
    clickTab(root, '最新');
    expect(active(p1)).toBe('latest');
    const { page } = await boot('?taskId=t1');   // 返回 = 重载，参数还在
    expect(active(page)).toBe('latest');         // ← 预期失败：被 handleParams 抢回 query
  });

  it('带 source 参数（助手跳入）：切「最新」→ 重载后仍在「最新」', async () => {
    const { root } = await boot('?source=foxwq');
    clickTab(root, '最新');
    const { page } = await boot('?source=foxwq');
    expect(active(page)).toBe('latest');
  });
});
