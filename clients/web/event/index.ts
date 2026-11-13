/**
 * Event 首页 Shell
 * @description 查询表单页入口，组装依赖并挂载 EventPage
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { DEFAULT_EVENT_CONFIG } from '../shared/defaultConfig';
import { EventPage } from '../../../presentation/adapters/web/pages/event';
import { createEventDeps } from '../shared/deps/event';
import { LocalStorageAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageAdapter';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
    moduleConfigs: { event: DEFAULT_EVENT_CONFIG },
  });

  const { querier, formatter } = await createEventDeps(ctx);

  const storage = new LocalStorageAdapter('weiqi-bot-event');

  const page = new EventPage({
    eventQuerier: querier,
    storage,
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
    // 带参直达：查询页不再拉数据，直接把条件交给列表页串行拉取一次即可，
    // 避免首页拉一遍又跳列表页再拉一遍（两次进度条）。
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([key]) => key !== 'auto')
    );
    const qs = new URLSearchParams(cleanParams).toString();
    window.location.replace(`events.html${qs ? '?' + qs : ''}`);
    return;
  } else if (Object.keys(params).length > 0) {
    page.handleParams(params);
  }

  page.render();

  console.info('EventPage 首页已启动');
}

main().catch(console.error);
