/**
 * 真人对弈页面入口
 * @description Web Shell 真人对弈页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { HHPlayPage } from '../../../presentation/adapters/web/pages/play';
import { HHPlayApp } from '../../../application/play';
import { HHPlayService } from '../../../services/play/hh';
import { AIController } from '../../../services/ai';
import { ActivityLogService } from '../../../services/activity';
import { Game } from '../../../domain/game';
import { createAIEngine } from '../../../infrastructure/ai';
import { InMemoryDocumentStorage } from '../../../infrastructure/storage/adapters/common/InMemoryDocumentStorage';
import { LocalStorageAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import { createGameDeps } from '../shared/deps/game';
import { RecorderHistoryManager } from '../../../application/recorder';
import { DefaultModelService } from '../../../services/model';
import type { ActivityEntry } from '../../../services/activity';
import type { WebShellContext } from '../shared/Context';
import { getWebRoot } from '../../../infrastructure/utils/web/pathUtils';

async function main() {
  // 1. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  // 2. 创建游戏实例
  const game = new Game();

  // 3. 创建 KataGo 适配器（用于数子）
  const kataGoEngine = createAIEngine();
  const aiController = new AIController(kataGoEngine);

  // 3.1 初始化 AI 模型（异步加载，不阻塞页面渲染）
  // 先加载模型配置，找到默认模型
  const { getWebRoot } = await import('../../../infrastructure/utils/web/pathUtils');
  const webRoot = getWebRoot();
  const configUrl = webRoot + 'models/model-config.json';
  
  let modelId = DefaultModelService.getDefaultModelId(); // fallback
  let modelUrl = DefaultModelService.getDefaultModelFullUrl(webRoot); // fallback
  try {
    const response = await fetch(configUrl);
    if (response.ok) {
      const modelConfig = await response.json();
      const defaultModel = modelConfig.models?.find((m: any) => m.default === true);
      if (defaultModel) {
        modelId = defaultModel.id;
        modelUrl = webRoot + defaultModel.url;
        console.info('[HH] 从配置中找到默认模型:', modelId);
      }
    }
  } catch (error) {
    console.warn('[HH] 加载模型配置失败，使用 fallback:', error);
  }
  
  console.log('[HH] Using model URL:', modelUrl);
  
  aiController.init(modelId, modelUrl, (loaded, total, progress) => {
    console.log(`[HH] AI 初始化进度: ${Math.round(progress * 100)}%`);
  }).then(() => {
    console.info('AI 模型加载完成，数子功能已就绪');
  }).catch((error) => {
    console.error('AI 模型加载失败', error);
  });

  // 4. 创建存储适配器（用于草稿保存）
  const playStorage = new LocalStorageAdapter('weiqi-play');
  await playStorage.initialize();
  
  // 5. 创建 HHPlayService
  const hhPlayService = new HHPlayService(game, ctx.config, aiController, playStorage);

  // 5.1 创建 ActivityLogService（作为 fallback）
  const activityStorage = new InMemoryDocumentStorage<ActivityEntry>();
  await activityStorage.initialize();
  const activityLogService = new ActivityLogService(activityStorage, ctx.config);
  await activityLogService.initialize();

  // 6. 创建 GameService 和 HistoryManager（用于归档棋谱）
  const { gameService } = await createGameDeps(ctx);
  const historyManager = new RecorderHistoryManager(
    gameService,
    ctx.favoriteService,
    'play', // 使用 'play' 类别，统一所有对弈棋谱
  );

  // 7. 创建 HHPlayApp，注入 historyManager
  const hhPlayApp = new HHPlayApp(
    hhPlayService,
    undefined, // modelService - 真人对弈不需要
    activityLogService, // activityLogService - 作为 fallback
    historyManager, // historyManager - 优先使用
  );

  // 7. 创建页面
  const page = new HHPlayPage({
    hhPlayApp,
    logger: ctx.logger,
    onNavigate: (pageId: string) => {
      if (pageId === 'home') {
        window.location.href = getWebRoot() + 'index.html';
      }
    },
  });

  // 8. 初始化
  await page.initialize();

  // 9. 处理 URL 参数
  const urlParams = new URLSearchParams(window.location.search);
  const params: Record<string, string> = {};
  urlParams.forEach((value, key) => {
    params[key] = value;
  });
  page.handleParams(params);

  // 10. 渲染
  page.render();

  // 11. 绑定菜单按钮事件
  const menuBtn = document.getElementById('menuBtn');
  const dropdownMenu = document.getElementById('dropdownMenu');
  
  // 菜单按钮点击事件
  menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu?.classList.toggle('visible');
  });
  
  // 点击其他地方关闭菜单
  document.addEventListener('click', (e) => {
    if (!dropdownMenu?.contains(e.target as Node)) {
      dropdownMenu?.classList.remove('visible');
    }
  });
  
  // 绑定菜单项事件
  document.getElementById('undoMenuItem')?.addEventListener('click', () => {
    page.requestUndo();
    dropdownMenu?.classList.remove('visible');
  });
  document.getElementById('passMenuItem')?.addEventListener('click', () => {
    page.pass();
    dropdownMenu?.classList.remove('visible');
  });
  document.getElementById('countMenuItem')?.addEventListener('click', () => {
    page.requestCount();
    dropdownMenu?.classList.remove('visible');
  });
  document.getElementById('resignMenuItem')?.addEventListener('click', () => {
    page.resign();
    dropdownMenu?.classList.remove('visible');
  });

  // 12. 绑定确认按钮事件
  document.getElementById('confirmBtn')?.addEventListener('click', () => page.confirmMove());

  // 13. 同步菜单项的 disabled 状态（观察原有按钮的状态）
  const confirmBtn = document.getElementById('confirmBtn');
  const undoBtn = document.getElementById('undoBtn');
  const passBtn = document.getElementById('passBtn');
  const countBtn = document.getElementById('countBtn');
  const resignBtn = document.getElementById('resignBtn');
  
  // 如果原有按钮存在，观察它们的 disabled 状态并同步到菜单项
  const syncDisabledState = () => {
    if (undoBtn) {
      const undoMenuItem = document.getElementById('undoMenuItem');
      if (undoMenuItem) undoMenuItem.disabled = undoBtn.disabled;
    }
    if (passBtn) {
      const passMenuItem = document.getElementById('passMenuItem');
      if (passMenuItem) passMenuItem.disabled = passBtn.disabled;
    }
    if (countBtn) {
      const countMenuItem = document.getElementById('countMenuItem');
      if (countMenuItem) countMenuItem.disabled = countBtn.disabled;
    }
    if (resignBtn) {
      const resignMenuItem = document.getElementById('resignMenuItem');
      if (resignMenuItem) resignMenuItem.disabled = resignBtn.disabled;
    }
  };
  
  // 使用 MutationObserver 观察按钮的 disabled 属性变化
  const observer = new MutationObserver(syncDisabledState);
  [undoBtn, passBtn, countBtn, resignBtn].forEach(btn => {
    if (btn) {
      observer.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
    }
  });
  
  // 初始同步一次
  syncDisabledState();

  console.info('HHPlayPage 已启动');
}

main().catch(console.error);
