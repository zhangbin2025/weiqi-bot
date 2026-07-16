/**
 * AI自对弈页面入口
 * @description Web Shell AI自对弈页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { MMPlayPage } from '../../../presentation/adapters/web/pages/play';
import { MMPlayApp } from '../../../application/play';
import { MMPlayService } from '../../../services/play/mm';
import { AIController } from '../../../services/ai';
import { ActivityLogService } from '../../../services/activity';
import { ModelService, ModelManagementService } from '../../../services/model';
import { Game } from '../../../domain/game';
import { createAIEngine } from '../../../infrastructure/ai';
import { InMemoryDocumentStorage } from '../../../infrastructure/storage/adapters/common/InMemoryDocumentStorage';
import { IndexedDBAdapter } from '../../../infrastructure/storage/adapters/web/IndexedDBAdapter';
import { LocalStorageAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import { DirectProvider } from '../../../infrastructure/network/adapters/web/DirectProvider';
import { showSettingsDialog } from '../../../presentation/adapters/web/pages/play/MMPlayDialogManager';
import type { MMDialogOptions } from '../../../presentation/adapters/web/pages/play/MMPlayDialogManager';
import { createGameDeps } from '../shared/deps/game';
import { RecorderHistoryManager } from '../../../application/recorder';
import type { ActivityEntry } from '../../../services/activity';

async function main() {
  // 1. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  // 2. 创建游戏实例
  const game = new Game();

  // 3. 从 WebBootstrap 获取 NetworkManager（App 环境需要，用于代理下载非同源模型）
  const networkManager = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp')
    ? ctx.network
    : undefined;

  // 4. 创建 KataGo 适配器和 AIController
  const kataGoEngine = createAIEngine(networkManager);
  const aiController = new AIController(kataGoEngine);

  // 5. 创建 ModelService
  const modelStorage = new IndexedDBAdapter<{ id: string; data: Blob; timestamp: number }>('weiqi-models', 'models');
  await modelStorage.initialize();
  const directProvider = new DirectProvider();
  const modelService = new ModelService(ctx.config, directProvider, modelStorage);

  // 6. 创建 ModelManagementService（统一管理模型）
  const preferenceStorage = new LocalStorageAdapter('weiqi-model');
  await preferenceStorage.initialize();
  const modelManager = new ModelManagementService(modelService, aiController, preferenceStorage);

  // 6.1 恢复用户偏好（只恢复配置，不加载模型）
  try {
    const savedModelId = await modelManager.loadPreference();
    if (savedModelId) {
      console.info('[mm.ts] 恢复用户偏好：', savedModelId);
      // 注意：不在这里加载模型，只是记录偏好
      // 等用户点击"开始对局"时再加载
    }
  } catch (error) {
    console.error('[mm.ts] 恢复用户偏好失败：', error);
  }

  // 7. 创建 MMPlayService（传入同一个 aiController 实例）
  const mmPlayService = new MMPlayService(kataGoEngine, ctx.config, aiController);

  // 6. 创建 ActivityLogService
  const activityStorage = new InMemoryDocumentStorage<ActivityEntry>();
  await activityStorage.initialize();
  const activityLogService = new ActivityLogService(activityStorage, ctx.config);
  await activityLogService.initialize();

  // 7. 创建 GameService 和 HistoryManager
  const { gameService } = await createGameDeps(ctx);
  const historyManager = new RecorderHistoryManager(
    gameService,
    ctx.favoriteService,
    'play',
  );

  // 8. 创建 MMPlayApp
  const mmPlayApp = new MMPlayApp(mmPlayService, modelService, activityLogService, historyManager);

  // 9. 创建 MMPlayPage
  const page = new MMPlayPage({
    mmPlayApp,
    logger: ctx.logger,
    kataGoEngine,
    historyManager,
    modelManager,
    onNavigate: (pageId: string) => {
      if (pageId === 'home') {
        window.location.href = getWebRoot() + 'index.html';
      }
    },
    onShowSettingsDialog: () => {
      showSettingsDialog(mmPlayApp, {
        onStart: async (options: MMDialogOptions) => {
          await page.startAutoPlay(options);
        },
      }, modelManager);
    },
  });

  // 10. 初始化页面
  await page.initialize();

  // 11. 显示设置对话框（只有没有草稿时才显示）
  if (!page.hasDraftToRecover()) {
    showSettingsDialog(mmPlayApp, {
      onStart: async (options: MMDialogOptions) => {
        await page.startAutoPlay(options);
      },
    }, modelManager);
  } else {
    // 有草稿，恢复对局后会自动启动，需要同步状态
    setTimeout(() => {
      page.syncStateFromApp();
    }, 1000);
  }

  // 定期同步状态
  setInterval(() => {
    page.syncStateFromApp();
  }, 2000);
}

main().catch(console.error);
