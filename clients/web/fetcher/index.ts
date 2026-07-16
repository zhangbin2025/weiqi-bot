/**
 * 棋谱抓取页面入口
 * @description Web Shell 棋谱抓取页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { createGameDeps } from '../shared/deps/game';
import { FetcherPage } from '../../../presentation/adapters/web/pages/fetcher';
import { FetcherApp } from '../../../application/fetcher';
import { ExportService } from '../../../services/export/ExportService';
import { ShareService } from '../../../services/share/ShareService';
import { WebFileExporter } from '../../../infrastructure/utils/export/WebFileExporter';
import { SessionService } from '../../../services/session/SessionService';
import { LocalStorageCacheAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageCacheAdapter';

async function main() {
  // 1. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
    moduleConfigs: {
      game: {
        enableCache: true,
        maxHistorySize: 100,
      },
    },
  });

  // 2. 创建文件导出器
  const fileExporter = new WebFileExporter();

  // 3. 创建导出服务
  const exportService = new ExportService(fileExporter);

  // 4. 创建 Game 服务（包含归档存储和缓存）
  const { gameService } = await createGameDeps(ctx);

  // 5. 创建分享服务
  const shareService = new ShareService('https://weiqi-dev.github.io/weiqi-assets/share/');

  // 6. 创建 FetcherApp（使用 Shell 上下文的收藏服务）
  const fetcherApp = new FetcherApp(
    gameService,
    exportService,
    ctx.favoriteService,
    shareService,
  );

  // 7. 创建 SessionService（用于从 assistant 页面传递 SGF）
  let sessionService;
  try {
    const cacheStorage = new LocalStorageCacheAdapter('weiqi-session');
    if (cacheStorage.isAvailable()) {
      sessionService = new SessionService(cacheStorage);
      await sessionService.initialize();
    }
  } catch (error) {
    console.warn('[fetcher] SessionService 初始化失败，sessionId 参数将不可用:', error);
  }

  // 8. 创建页面
  const page = new FetcherPage({
    fetcherApp,
    logger: ctx.logger,
    adapterFactory: ctx.adapterFactory,
    sessionService,
    onNavigate: (pageId, params) => {
      if (pageId === 'replay') {
        const searchParams = new URLSearchParams(params);
        window.location.href = `../replay/index.html?${searchParams.toString()}`;
      }
    },
  });

  // 9. 初始化
  await page.initialize();

  // 10. 处理 URL 参数
  const urlParams = new URLSearchParams(window.location.search);
  const auto = urlParams.get('auto');
  const params: Record<string, string> = {};
  urlParams.forEach((value, key) => {
    if (key !== 'auto') { // 排除 auto 参数
      params[key] = value;
    }
  });
  
  if (auto === 'true' && Object.keys(params).length > 0) {
    // 执行后立即移除 auto 参数，避免返回时重复触发
    const newUrl = Object.keys(params).length > 0
      ? `${window.location.pathname}?${new URLSearchParams(params).toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
    
    // 自动触发抓谱
    await page.handleParams(params);
  } else if (Object.keys(params).length > 0) {
    // 只填充参数，不自动抓谱
    await page.handleParams(params);
  }

  // 11. 渲染
  page.render();

  console.info('FetcherPage 已启动');
}

main().catch(console.error);
