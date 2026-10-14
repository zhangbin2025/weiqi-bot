/**
 * 后台任务通知链接（FetcherPage.buildNotifyLink）测试
 * @description 核心不变量：后台任务通知里的「实战选点」链接，必须与前台三点菜单
 *              跳转（onNavigate('decision')）拼出来的 URL 完全一致。
 *              历史上此处漏了 src、多了 auto=true，导致：
 *                - src 缺失 → decision 页面把 archiveId 当展示名，历史条目显示一长串 id
 *                - auto=true → 一旦 handleTaskParams 提前 return（scheduleId /
 *                  view=favorite），页面走「在线默认生成」，抓的这盘棋谱被丢掉
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FetcherPage } from '../FetcherPage';
import { WebAdapterFactory } from '../../../WebAdapterFactory';
import type { FetcherResult } from '../../../../../../application/fetcher';

const AI_REVIEW_URL = 'lib://ai-review/2026-10-13/0';
const ARCHIVE_ID = 'arch-1';

function makeResult(over: Partial<FetcherResult> = {}): FetcherResult {
  return {
    success: true,
    archiveId: ARCHIVE_ID,
    source: 'lib-ai-review',
    url: AI_REVIEW_URL,
    fromCache: false,
    metadata: { black: '柯洁', white: '申真谞', date: '2026-10-13', movesCount: 210 },
    ...over,
  } as FetcherResult;
}

/** 抓一次棋谱并捕获发往原生的 task:complete 载荷 */
async function captureComplete(result: FetcherResult): Promise<Record<string, any>> {
  const fetcherApp = {
    fetch: vi.fn().mockResolvedValue(result),
    getBookmarks: vi.fn().mockResolvedValue([]),
    getArchiveContent: vi.fn().mockResolvedValue(undefined),
  } as any;

  const root = document.createElement('div');
  document.body.appendChild(root);
  const adapterFactory = new WebAdapterFactory();
  adapterFactory.setRootContainer(root);

  const page = new FetcherPage({ fetcherApp, adapterFactory });
  // 渲染器在后台会话里不需要真实交互，替换成空壳避免副作用
  (page as any).renderer = {
    showLoading: vi.fn(), showError: vi.fn(), showResult: vi.fn(),
    setCurrentResult: vi.fn(), updateResultActions: vi.fn(),
    renderBookmarks: vi.fn(), switchToQueryTab: vi.fn(),
  } as any;

  const prompts: string[] = [];
  vi.stubGlobal('prompt', (msg: string) => { prompts.push(msg); return ''; });

  await (page as any).fetchByUrl(result.url ?? AI_REVIEW_URL, 'task-1');

  const complete = prompts.find((p) => p.startsWith('task:complete:'));
  expect(complete).toBeTruthy();
  return JSON.parse(complete!.slice('task:complete:'.length));
}

describe('后台任务通知链接', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AI review 棋谱：主链接是实战选点，且与前台跳转参数完全一致', async () => {
    const payload = await captureComplete(makeResult());

    expect(payload.title).toBe('抓取完成');
    // 消息里的首个链接即首要动作
    const link = /\[实战选点\]\(([^)]+)\)/.exec(payload.message)?.[1];
    expect(link).toBeTruthy();

    // 前台跳转的等价形式：onNavigate('decision', {archiveId, source, src})
    const nav = new URLSearchParams({
      archiveId: ARCHIVE_ID,
      source: 'lib-ai-review',
      src: AI_REVIEW_URL,
    }).toString();
    expect(link).toBe('/decision/index.html?' + nav);
  });

  it('实战选点链接带 src（否则历史条目会显示一长串 archiveId）', async () => {
    const payload = await captureComplete(makeResult());
    const link = /\[实战选点\]\(([^)]+)\)/.exec(payload.message)![1];
    const q = new URLSearchParams(link.split('?')[1]);
    expect(q.get('src')).toBe(AI_REVIEW_URL);
  });

  it('实战选点链接不带 auto=true（否则会退化成在线默认生成）', async () => {
    const payload = await captureComplete(makeResult());
    const link = /\[实战选点\]\(([^)]+)\)/.exec(payload.message)![1];
    expect(link).not.toContain('auto=');
  });

  it('一般棋谱：主链接是打谱，同样带 src', async () => {
    const url = 'https://example.com/g/1';
    const payload = await captureComplete(makeResult({ source: 'foxwq', url }));
    expect(payload.message).toContain('[打谱]');
    const link = /\[打谱\]\(([^)]+)\)/.exec(payload.message)![1];
    expect(link).toBe('/replay/index.html?archiveId=' + ARCHIVE_ID +
      '&src=' + encodeURIComponent(url));
  });
});
