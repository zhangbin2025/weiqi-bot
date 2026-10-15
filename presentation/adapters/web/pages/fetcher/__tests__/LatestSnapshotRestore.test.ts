/**
 * 返回恢复：用快照渲染，不重查
 * @description 复现「点条目 → 跳走 → 返回整页重载」的真实时序。
 *              断言恢复时 fetchLatestGames 不再被调用（快照命中），
 *              且列表顺序与离开时逐条一致 —— 这正是 OGS -modified 漂移
 *              导致「看完返回，条目跑到第一条」的回归防线。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetcherPage } from '../FetcherPage';
import { WebAdapterFactory } from '../../../WebAdapterFactory';

type Item = { source: string; title: string; date: string; url: string };
const item = (n: string, url: string): Item => ({ source: 'ogs-puzzle', title: n, date: '2026-10-15', url });

const ITEMS: Item[] = [
  item('OGS-A', 'https://online-go.com/puzzle/1'),
  item('OGS-B', 'https://online-go.com/puzzle/2'),
  item('OGS-C', 'https://online-go.com/puzzle/3'),
];
/** 模拟"服务端顺序变了"：返回后若重查就会拿到这个新顺序 */
const DRIFTED: Item[] = [ITEMS[2]!, ITEMS[0]!, ITEMS[1]!];

function makeApp(items: Item[]) {
  return {
    fetch: vi.fn().mockResolvedValue({ success: true, archiveId: 'a1', source: 'ogs-puzzle', url: ITEMS[0]!.url, metadata: {} }),
    getBookmarks: vi.fn().mockResolvedValue([]),
    fetchLatestGames: vi.fn().mockResolvedValue(items),
    getArchiveContent: vi.fn().mockResolvedValue(undefined),
  } as any;
}

async function boot(app: any): Promise<FetcherPage> {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  root.id = 'page-root';
  document.body.appendChild(root);
  const factory = new WebAdapterFactory();
  factory.setRootContainer(root);
  const page = new FetcherPage({ fetcherApp: app, adapterFactory: factory });
  await page.initialize();
  page.render();
  return page;
}

/** 渲染出来的条目 URL 顺序 */
const renderedUrls = () =>
  Array.from(document.querySelectorAll('[data-action="selectLatest"]'))
    .map((el) => el.getAttribute('data-url'))
    .filter((u): u is string => !!u);

/** 制造"有查询条件缓存、但没有快照"的返回态 */
function seedSourceOnly(source: string, keyword: string) {
  sessionStorage.setItem('weiqi-bot:fetcher_latest_source', JSON.stringify(source));
  sessionStorage.setItem(`weiqi-bot:fetcher_latest_keyword_${source}`, JSON.stringify(keyword));
}

describe('最新列表返回恢复', () => {
  beforeEach(() => { document.body.innerHTML = ''; sessionStorage.clear(); });

  it('查询后写快照；返回恢复时不再重查，顺序与离开时一致', async () => {
    const app = makeApp(ITEMS);
    const page1 = await boot(app);

    // 用户在「最新」选了 OGS死活题来源 → 触发一次查询
    await (page1 as any).fetchLatestGames('ogs-puzzle', '');
    expect(app.fetchLatestGames.mock.calls.length).toBe(1);

    // ── 点条目跳走再返回：整页重载，新实例，服务端顺序已漂移 ──
    const app2 = makeApp(DRIFTED);
    await boot(app2);

    expect(app2.fetchLatestGames).not.toHaveBeenCalled();
    expect(renderedUrls()).toEqual(ITEMS.map((i) => i.url));
  });

  it('快照缺失时退回重查，列表照常渲染', async () => {
    const app = makeApp(DRIFTED);
    seedSourceOnly('ogs-puzzle', '');   // 有查询条件，但快照为空

    await boot(app);

    expect(app.fetchLatestGames).toHaveBeenCalledWith('ogs-puzzle', 100, undefined);
    expect(renderedUrls()).toEqual(DRIFTED.map((i) => i.url));
  });

  it('关键字变了则不复用旧快照，改为重查', async () => {
    const app1 = makeApp(ITEMS);
    const page1 = await boot(app1);
    await (page1 as any).fetchLatestGames('ogs-puzzle', '5k');
    expect(await (page1 as any).latestCache.load('ogs-puzzle', '5k')).toHaveLength(3);

    // 返回时查询条件已换成空关键字（用户改过筛选）
    sessionStorage.setItem('weiqi-bot:fetcher_latest_keyword_ogs-puzzle', JSON.stringify(''));
    const app2 = makeApp(DRIFTED);
    await boot(app2);

    expect(app2.fetchLatestGames).toHaveBeenCalledWith('ogs-puzzle', 100, undefined);
  });
});
