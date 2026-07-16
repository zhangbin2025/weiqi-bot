/**
 * 人机对弈页面入口
 * @description Web Shell 人机对弈页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { HMPlayPage } from '../../../presentation/adapters/web/pages/play';
import { HMPlayApp } from '../../../application/play';
import { HMPlayService } from '../../../services/play/hm';
import { AIController } from '../../../services/ai';
import { ActivityLogService } from '../../../services/activity';
import { ModelService, ModelManagementService, DefaultModelService } from '../../../services/model';
import { Game } from '../../../domain/game';
import { createAIEngine } from '../../../infrastructure/ai';
import { InMemoryDocumentStorage } from '../../../infrastructure/storage/adapters/common/InMemoryDocumentStorage';
import { IndexedDBAdapter } from '../../../infrastructure/storage/adapters/web/IndexedDBAdapter';
import { LocalStorageAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import { DirectProvider } from '../../../infrastructure/network/adapters/web/DirectProvider';
import { showLoading, updateProgress, hideLoading, setInitProgress } from './shared/ProgressManager';
import { createGameDeps } from '../shared/deps/game';
import { RecorderHistoryManager } from '../../../application/recorder';
import type { ActivityEntry } from '../../../services/activity';

async function main() {
  // 强制隐藏加载覆盖层
  hideLoading();

  // 1. 先加载模型配置，找到默认模型
  const { getWebRoot } = await import('../../../infrastructure/utils/web/pathUtils');
  const webRoot = getWebRoot();
  const configUrl = webRoot + 'models/model-config.json';
  
  let defaultModelId = DefaultModelService.getDefaultModelId(); // fallback
  try {
    const response = await fetch(configUrl);
    if (response.ok) {
      const modelConfig = await response.json();
      const defaultModel = modelConfig.models?.find((m: any) => m.default === true);
      if (defaultModel) {
        defaultModelId = defaultModel.id;
        console.info('[hm.ts] 从配置中找到默认模型:', defaultModelId);
      }
    }
  } catch (error) {
    console.warn('[hm.ts] 加载模型配置失败，使用 fallback:', error);
  }

  // 2. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
    moduleConfigs: {
      hmplay: {
        defaultDifficulty: 'medium',
        defaultModelId: defaultModelId,
        defaultVisits: { easy: 50, medium: 100, hard: 200 },
        defaultNoUndo: false,
      },
    },
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
      console.info('[hm.ts] 恢复用户偏好：', savedModelId);
      // 注意：不在这里加载模型，只是记录偏好
      // 等用户点击"开始对局"时再加载
    }
  } catch (error) {
    console.error('[hm.ts] 恢复用户偏好失败：', error);
  }

  // 7. 创建 HMPlayService
  const hmPlayService = new HMPlayService(game, aiController, ctx.config);

  // 6. 创建 ActivityLogService(作为 fallback)
  const activityStorage = new InMemoryDocumentStorage<ActivityEntry>();
  await activityStorage.initialize();
  const activityLogService = new ActivityLogService(activityStorage, ctx.config);
  await activityLogService.initialize();

  // 7. 创建 GameService 和 HistoryManager(用于归档棋谱)
  const { gameService } = await createGameDeps(ctx);
  const historyManager = new RecorderHistoryManager(
    gameService,
    ctx.favoriteService,
    'play',
  );

  // 8. 创建 HMPlayApp,注入 historyManager
  const hmPlayApp = new HMPlayApp(hmPlayService, modelService, activityLogService, historyManager);

  // 8.1 加载模型列表
  let modelCards: Array<{ id: string; name: string; size: string }> = [];
  try {
    await hmPlayApp.loadModels();
    const models = await hmPlayApp.getModels();
    modelCards = models.map(m => ({ id: m.id, name: m.name, size: m.size }));
    console.info('模型列表加载完成', modelCards);
  } catch (error) {
    console.error('加载模型列表失败', error);
    // 使用默认模型列表（使用之前找到的默认模型）
    modelCards = [{ id: defaultModelId, name: 'KataGo', size: '10.6MB' }];
  }

  // 9. 创建 HMPlayPage
  const page = new HMPlayPage({
    hmPlayApp,
    historyManager,
    game,
    kataGoEngine,
    progressManager: {
      showLoading,
      updateProgress,
      setInitProgress,
      hideLoading,
    },
    modelManager,
    onNavigate: (pageId: string) => {
      if (pageId === 'home') {
        window.location.href = getWebRoot() + 'index.html';
      }
    },
    onShowOptionsDialog: () => {
      page.showOptionsDialog();
    },
    onUpdateTitleBar: (playerColor: 'black' | 'white') => {
      page.updateTitleBar(playerColor);
    },
    onUpdateButtons: (isPlayerTurn: boolean, gameEnded: boolean, canUndo: boolean) => {
      // 更新菜单按钮状态
      const menuUndoBtn = document.getElementById('menuUndoBtn') as HTMLButtonElement;
      const menuPassBtn = document.getElementById('menuPassBtn') as HTMLButtonElement;
      const menuSituationBtn = document.getElementById('menuSituationBtn') as HTMLButtonElement;
      const menuResignBtn = document.getElementById('menuResignBtn') as HTMLButtonElement;

      // 悔棋按钮:游戏结束、禁止悔棋、或轮到 AI 时禁用
      if (menuUndoBtn) {
        const currentOptions = page.getCurrentOptions();
        menuUndoBtn.disabled = gameEnded || (currentOptions?.noUndo ?? false) || !isPlayerTurn;
      }
      // 停一手按钮:游戏结束或轮到 AI 时禁用
      if (menuPassBtn) menuPassBtn.disabled = gameEnded || !isPlayerTurn;
      if (menuSituationBtn) menuSituationBtn.disabled = gameEnded;
      if (menuResignBtn) menuResignBtn.disabled = gameEnded;
    },
  });

  // 10. 设置模型卡片列表
  page.setModelCards(modelCards);

  // 11. 初始化页面
  await page.initialize();

  // 12. 绑定所有 UI 事件
  page.bindAllEvents();

  // 13. 显示选项对话框(只有没有草稿时才显示)
  if (!page.hasDraftToRecover()) {
    page.showOptionsDialog();
  }

  console.info('HMPlayPage 已启动');
}

main().catch(console.error);
