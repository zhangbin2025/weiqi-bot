/**
 * 定式挑战页面入口
 * @description Web Shell 定式挑战页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { JosekiQuizPage } from '../../../presentation/adapters/web/pages/joseki';
import { JosekiQuizApp } from '../../../application/joseki';
import { JosekiLoader } from '../../../services/joseki/JosekiLoader';
import { JosekiQuizService } from '../../../services/joseki/quiz/JosekiQuizService';
import { ActivityLogService } from '../../../services/activity/ActivityLogService';
import { FavoriteService } from '../../../services/favorite/FavoriteService';
import { WebAudioPlayer } from '../../../infrastructure/audio/WebAudioPlayer';
import { Select } from '../shared/ui';

async function main() {
  // 显示加载遮罩
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.innerHTML = `
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <div class="loading-title">加载题库</div>
      <div class="loading-status">初始化...</div>
      <div class="loading-progress">
        <div class="loading-progress-bar"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // 更新进度函数
  const updateProgress = (percent: number, status: string) => {
    const statusEl = overlay.querySelector('.loading-status');
    const barEl = overlay.querySelector('.loading-progress-bar') as HTMLElement;
    if (statusEl) statusEl.textContent = status;
    if (barEl) barEl.style.width = percent + '%';
  };

  // 1. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
    moduleConfigs: {
      joseki: {
        dataUrl: '../shared/assets/data/joseki',
        trieMetaFile: 'trie-meta.json',
        enableDynamicLoad: false,
      },
    },
  });

  // 挂载页面自定义下拉框
  Select.mountAll();

  // 2. 创建定式加载器
  const loader = new JosekiLoader(
    ctx.network,
    {
      async upload() {},
      async download() { throw new Error('Not cached'); },
      async delete() {},
      async exists() { return false; },
      async getMetadata() { throw new Error('Not implemented'); },
      async readChunk() { throw new Error('Not implemented'); },
      async listFiles() { return []; },
      async createDirectory() {},
      async deleteDirectory() {},
      async initialize() {},
    },
    ctx.config
  );

  // 预加载所有子树和题库
  updateProgress(5, '加载定式索引...');
  await loader.preloadAllSubtrees((percent, status) => {
    updateProgress(percent * 0.5, status); // 子树占 50%
  });
  
  // 预加载所有难度题库
  updateProgress(50, '加载初级题库...');
  await loader.loadQuizData('easy');
  updateProgress(70, '加载中级题库...');
  await loader.loadQuizData('medium');
  updateProgress(85, '加载高级题库...');
  await loader.loadQuizData('hard');
  updateProgress(100, '加载完成');

    // 3. 创建定式挑战服务
  const quizService = new JosekiQuizService(loader, async () => ({
    defaultDifficulty: 'easy',
    maxQuestions: 20,
  }));

  // 4. 创建收藏服务
  const favoriteStorage = await ctx.createCache(
    'weiqi-favorites',
    'items'
  );
  const favoriteService = new FavoriteService(favoriteStorage);

  // 5. 创建活动日志服务
  const activityStorage = await ctx.createCache(
    'weiqi-activity',
    'entries'
  );
  const activityLogService = new ActivityLogService(activityStorage);
  await activityLogService.initialize();

  // 6. 创建定式挑战应用（传入收藏服务）
  const quizApp = new JosekiQuizApp(
    quizService,
    activityLogService,
    undefined, // thumbnailService
    favoriteService
  );

  // 7. 创建音效播放器
  const audioPlayer = new WebAudioPlayer();

  // 8. 创建页面
  const page = new JosekiQuizPage({
    quizApp,
    logger: ctx.logger,
    audioPlayer,
  });

  // 9. 初始化
  await page.initialize();

  // 10. 处理 URL 参数
  const urlParams = new URLSearchParams(window.location.search);
  const params: Record<string, string> = {};
  urlParams.forEach((value, key) => {
    params[key] = value;
  });
  page.handleParams(params);

  // 11. 渲染
  page.render();

  // 隐藏加载遮罩
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }, 200);

  console.info('JosekiQuizPage 已启动');
}

main().catch(console.error);