/**
 * Event 列表页 Shell
 * @description 城市分组+折叠列表页入口，从 URL 参数读取查询条件
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { DEFAULT_EVENT_CONFIG } from '../shared/defaultConfig';
import { EventListPage } from '../../../presentation/adapters/web/pages/event';
import { createEventDeps } from '../shared/deps/event';
import { SessionPageCache } from '../shared/SessionPageCache';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
    moduleConfigs: { event: DEFAULT_EVENT_CONFIG },
  });

  const { querier, formatter } = await createEventDeps(ctx);

  // 从 URL 读取查询参数
  const urlParams = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  const page = new EventListPage({
    eventQuerier: querier, logger: ctx.logger,
    adapterFactory: ctx.adapterFactory, formatter,
    pageCache: new SessionPageCache(ctx.sessionStorageService),
    onNavigate: (dest, params) => {
      if (dest === 'event/detail') {
        const qs = new URLSearchParams(params).toString();
        window.location.href = `detail.html?${qs}`;
      } else if (dest === 'event') {
        window.location.href = 'index.html';
      }
    },
  });

  await page.initialize();
  page.handleParams(urlParams);
  await page.loadEvents(urlParams);
  page.render();

  console.info('EventListPage 已启动');
}

main().catch(console.error);