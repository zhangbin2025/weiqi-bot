/**
 * AI 复盘页面入口
 * @module clients/web/review
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { ReviewPage } from '../../../presentation/adapters/web/pages/review';
import { ReviewApp, ReviewModelManager } from '../../../application/review';
import { ReviewService } from '../../../services/review';
import { ActivityLogService } from '../../../services/activity';
import { ModelService, ModelManagementService } from '../../../services/model';
import { AIController } from '../../../services/ai';
import { createAIEngine } from '../../../infrastructure/ai';
import { IndexedDBAdapter } from '../../../infrastructure/storage/adapters/web/IndexedDBAdapter';
import { LocalStorageAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import { DirectProvider } from '../../../infrastructure/network/adapters/web/DirectProvider';
import { SGFParser } from '../../../domain/sgf/SGFParser';
import { getWebRoot } from '../../../infrastructure/utils/web/pathUtils';
import { showLoading, updateProgress, hideLoading, setLoadingText } from '../play/shared/ProgressManager';
import { createGameDeps } from '../shared/deps/game';
import { WebAudioPlayer } from '../../../infrastructure/audio/WebAudioPlayer';

async function main() {
  // 1. 显示模型加载界面（先于一切）
  showLoading('正在加载 AI 模型...');

  // 2. 初始化 Web 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  // 3. 创建 GameService（用于棋谱归档）
  const { gameService } = await createGameDeps(ctx);

  // 3. 从 WebBootstrap 获取 NetworkManager（App 环境需要，用于代理下载非同源模型）
  const networkManager = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp')
    ? ctx.network
    : undefined;

  // 5. 创建 KataGo 引擎适配器和 AIController
  const kataGoEngine = createAIEngine(networkManager);
  const aiController = new AIController(kataGoEngine);

  // 6. 创建 ModelService
  const modelStorage = new IndexedDBAdapter<{ id: string; data: Blob; timestamp: number }>('weiqi-models', 'models');
  await modelStorage.initialize();
  const directProvider = new DirectProvider();
  const modelService = new ModelService(ctx.config, directProvider, modelStorage);

  try {
    await modelService.loadConfig();
    console.info('模型列表加载完成');
  } catch (error) {
    console.error('加载模型列表失败', error as Error);
  }

  // 7. 创建 ModelManagementService（统一管理模型）
  const preferenceStorage = new LocalStorageAdapter('weiqi-model');
  await preferenceStorage.initialize();
  const modelManager = new ModelManagementService(modelService, aiController, preferenceStorage);

  // 8. 恢复用户偏好（不加载模型，等到输入 SGF 时再加载）
  const savedModelId = await modelManager.loadPreference();
  if (savedModelId) {
    console.info('[Review] Saved model preference:', savedModelId);
  }

  // 9. 隐藏加载界面
  hideLoading();

  // 10. 初始化服务
  const sgfParser = new SGFParser();
  const reviewService = new ReviewService(aiController, sgfParser);
  const activityService = new ActivityLogService();
  const audioPlayer = new WebAudioPlayer();

  // 11. 初始化应用
  const reviewApp = new ReviewApp(reviewService, modelManager, activityService, audioPlayer);

  // 12. 初始化页面
  const page = new ReviewPage({
    reviewApp,
    gameService,
    favoriteService: ctx.favoriteService,
    modelManager,
    aiController,
    onNavigate: (pageName, params) => {
      console.info('Navigate to:', pageName, params);
    },
  });

  await page.initialize();

  // 暴露导出接口到全局
  (window as any).exportReviewData = () => {
    const data = page.getAnalysisData();
    console.log('=== 复盘分析数据 ===');
    console.log(JSON.stringify(data, null, 2));
    return data;
  };

  console.log('💡 提示：在控制台输入 exportReviewData() 可以导出分析数据');

  // 13. 处理 URL 参数（模型已就绪，无需 waitForReady）
  const urlParams = new URLSearchParams(window.location.search);
  const sgfParam = urlParams.get('sgf');
  const archiveIdParam = urlParams.get('archiveId');
  const taskId = urlParams.get('taskId');
  const viewParam = urlParams.get('view');
  const keyParam = urlParams.get('key');

  if (viewParam === 'favorite' && keyParam) {
    try {
      await page.viewFavorite(keyParam);
    } catch (e) {
      console.error('[Review] 加载收藏数据失败', e instanceof Error ? e : new Error(String(e)));
    }
  } else if (archiveIdParam) {
    try {
      await page.loadFromArchiveId(archiveIdParam, taskId);
    } catch (e) {
      console.error('[Review] 从归档ID加载棋谱失败', e instanceof Error ? e : new Error(String(e)));
    }
  } else if (sgfParam) {
    try {
      const sgf = decodeURIComponent(escape(atob(sgfParam)));
      await page.loadAndAnalyze(sgf);
    } catch (e) {
      console.error('SGF 参数解析失败', e instanceof Error ? e : new Error(String(e)));
    }
  }

  console.info('Review page initialized');
}

main().catch(console.error);
