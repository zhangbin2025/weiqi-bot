/**
 * Event 首页 Shell
 * @description 查询表单页入口，组装依赖并挂载 EventPage
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { DEFAULT_EVENT_CONFIG } from '../shared/defaultConfig';
import { EventPage } from '../../../presentation/adapters/web/pages/event';
import { createEventDeps } from '../shared/deps/event';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
    moduleConfigs: { event: DEFAULT_EVENT_CONFIG },
  });

  const { querier, ipGeoQuerier, formatter } = await createEventDeps(ctx);

  const page = new EventPage({
    eventQuerier: querier,
    ipGeoQuerier: ipGeoQuerier,
    logger: ctx.logger,
    adapterFactory: ctx.adapterFactory,
    formatter,
    onNavigate: (dest, params) => {
      const qs = new URLSearchParams(params).toString();
      if (dest === 'event/list') window.location.href = `events.html${qs ? '?' + qs : ''}`;
      if (dest === 'event/detail') window.location.href = `detail.html${qs ? '?' + qs : ''}`;
    },
  });

  await page.initialize();
  
  // 处理 URL 参数
  const urlParams = new URLSearchParams(window.location.search);
  const auto = urlParams.get('auto');
  const params = Object.fromEntries(urlParams.entries());
  
  if (auto === 'true' && Object.keys(params).length > 1) {
    // 执行后立即移除 auto 参数，避免返回时重复触发
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([key]) => key !== 'auto')
    );
    const newUrl = Object.keys(cleanParams).length > 0
      ? `${window.location.pathname}?${new URLSearchParams(cleanParams).toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
    
    // 自动触发搜索
    page.handleParams(params);
    await page.triggerQuery();
  } else if (Object.keys(params).length > 0) {
    // 只填充参数，不自动搜索
    page.handleParams(params);
  }
  
  page.render();

  console.info('EventPage 首页已启动');
}

main().catch(console.error);