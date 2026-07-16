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

  console.info('JosekiQuizPage 已启动');
}

main().catch(console.error);