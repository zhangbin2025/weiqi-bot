/**
 * 做题页面入口
 * @description 组装 PuzzleApp 依赖并启动做题页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { createGameDeps } from '../shared/deps/game';
import { PuzzlePage } from '../../../presentation/adapters/web/pages/puzzle';
import { PuzzleApp } from '../../../application/puzzle/PuzzleApp';
import { ExportService } from '../../../services/export/ExportService';
import { ShareService } from '../../../services/share/ShareService';
import { WebFileExporter } from '../../../infrastructure/utils/export/WebFileExporter';
import { WebAudioPlayer } from '../../../infrastructure/audio/WebAudioPlayer';
import { Select } from '../shared/ui';

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

  // 2. 创建 Game 服务（含归档存储与缓存）
  const { gameService } = await createGameDeps(ctx);

  // 3. 创建 FetcherApp（复用其 fetchLatestGames 取题能力）
  const fileExporter = new WebFileExporter();
  const exportService = new ExportService(fileExporter);
  const shareService = new ShareService('https://weiqi-dev.github.io/weiqi-assets/share/');
  const { FetcherApp } = await import('../../../application/fetcher/FetcherApp');
  const fetcherApp = new FetcherApp(
    gameService,
    exportService,
    ctx.favoriteService,
    shareService,
    ctx.network,
  );

  // 4. 活动日志服务（做题历史）
  const activityStorage = await ctx.createCache('weiqi-activity', 'entries');
  const { ActivityLogService } = await import('../../../services/activity/ActivityLogService');
  const activityLogService = new ActivityLogService(activityStorage);
  await activityLogService.initialize();

  // 5. 创建做题应用
  const puzzleApp = new PuzzleApp(gameService, fetcherApp, activityLogService);

  // 6. 创建页面
  const page = new PuzzlePage({
    puzzleApp,
    audioPlayer: new WebAudioPlayer(),
    onNavigate: (pageId, params) => {
      if (pageId === 'home') window.location.replace('../index.html');
      // 跳打谱页查看本题棋谱（SGF 原文以 base64 传递）
      if (pageId === 'replay') {
        const searchParams = new URLSearchParams(params);
        window.location.href = `../replay/index.html?${searchParams.toString()}`;
      }
    },
  });

  // 7. 初始化
  await page.initialize();

  // 挂载自绘下拉框（initialize 内部可能已挂载，这里兜底）
  Select.mountAll();

  // 8. 处理 URL 参数
  const urlParams = new URLSearchParams(window.location.search);
  const params: Record<string, string> = {};
  urlParams.forEach((value, key) => { params[key] = value; });
  await page.handleParams(params);

  // 9. 渲染
  page.render();


  console.info('PuzzlePage 已启动');
}

main().catch(console.error);
