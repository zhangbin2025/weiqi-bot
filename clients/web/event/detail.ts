/**
 * Event 详情页 Shell
 * @description 排名+对阵详情页入口，从 URL 参数读取 eventId/title
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { DEFAULT_EVENT_CONFIG } from '../shared/defaultConfig';
import { EventDetailPage } from '../../../presentation/adapters/web/pages/event';
import { createEventDeps } from '../shared/deps/event';
import { SessionPageCache } from '../shared/SessionPageCache';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
    moduleConfigs: { event: DEFAULT_EVENT_CONFIG },
  });

  const { querier, formatter } = await createEventDeps(ctx);

  // 从 URL 读取参数
  const urlParams = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  const pageCache = new SessionPageCache(ctx.sessionStorageService);
  await pageCache.init(); // 从 sessionStorage 恢复缓存到内存

  const page = new EventDetailPage({
    eventQuerier: querier, logger: ctx.logger,
    adapterFactory: ctx.adapterFactory, formatter,
    pageCache,
    onNavigate: (dest) => {
      if (dest === 'event/list') window.location.href = 'events.html';
    },
  });

  await page.initialize();
  page.render();
  page.handleParams(urlParams);

  // 记录访问（确保 IndexedDB 写入完成）
  if (urlParams['eventId'] && urlParams['title']) {
    try { await querier.recordVisited(parseInt(urlParams['eventId'], 10), urlParams['title']); } catch { /* 忽略 */ }
  }

  console.info('EventDetailPage 已启动');
}

main().catch(console.error);