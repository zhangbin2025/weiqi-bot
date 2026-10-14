/**
 * 定式发现页面入口
 * @description Web Shell 定式发现页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { JosekiDiscoverPage } from '../../../presentation/adapters/web/pages/joseki';
import { JosekiDiscoverApp } from '../../../application/joseki';
import { JosekiLoader } from '../../../services/joseki/JosekiLoader';
import { JosekiDiscoverService } from '../../../services/joseki/discover/JosekiDiscoverService';
import { createGameDeps } from '../shared/deps/game';
import { Select } from '../shared/ui';
import { TaskHelper } from '../shared/task-helper';

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

  // 3. 创建定式发现服务
  const discoverService = new JosekiDiscoverService(loader);

  // 4. 创建棋谱服务（带归档存储）
  const { gameService } = await createGameDeps(ctx);

  // 5. 使用全局收藏服务
  const favoriteService = ctx.favoriteService;

  // 6. 创建定式发现应用
  const discoverApp = new JosekiDiscoverApp(
    gameService,
    discoverService,
    loader,
    favoriteService
  );

  // 7. 创建页面
  const page = new JosekiDiscoverPage({
    discoverApp,
    gameService,
    onNavigate: (pageId, params) => {
      if (pageId === 'joseki/list') {
        window.location.href = `list.html?${new URLSearchParams(params).toString()}`;
      }
    },
  });

  // 8. 初始化
  await page.initialize();

  // 9. 解析任务参数
  const taskParams = TaskHelper.parseTaskParams();
  
  // 10. 处理任务参数
  const handled = await TaskHelper.handleTaskParams(taskParams, {
    onExecuteSchedule: async (params, scheduleId) => {
      const limit = params.limit || 20;
      await page.executeDiscover(limit, scheduleId);
    },
    onViewFavorite: async (key) => {
      await page.viewFavorite(key);
    },
  });
  
  if (handled) {
    return; // 任务已处理，终止后续逻辑
  }

  // 11. 正常页面加载逻辑
  const urlParams = new URLSearchParams(window.location.search);
  const params: Record<string, string> = {};
  urlParams.forEach((value, key) => {
    params[key] = value;
  });
  // 从 fetcher 跳转（archiveId）：页面内部按归档读取并自动分析。
  // 先把 archiveId 从 URL 里摘掉再触发：Android 不支持 bfcache，返回即整页
  // 重载，残留的 archiveId 会让定式发现再跑一遍 —— 历史里于是多出一条一模
  // 一样的记录（导入路径的 key 是 local_时间戳，两次必然不重合）。
  // 与 decision/index.ts 处理 archiveId 的方式保持一致。
  const archiveId = urlParams.get('archiveId');
  if (archiveId) {
    urlParams.delete('archiveId');
    const cleanedUrl = urlParams.toString()
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', cleanedUrl);
  }

  // 先处理 tab 等常规参数（切换标签页）
  page.handleParams(params);

  // 从 fetcher 跳转（archiveId）：页面内部按归档读取并自动分析
  if (archiveId) {
    page.render();
    return;
  }

  // 处理 auto=true 参数（自动执行）
  const auto = urlParams.get('auto');
  if (auto === 'true') {
    // 移除 auto 参数，避免返回时重复触发
    urlParams.delete('auto');
    const newUrl = urlParams.toString()
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
    
    // 自动触发定式发现（使用默认参数）
    const limit = 20;
    
    await page.executeDiscover(limit, taskParams.taskId);
  }

  // 12. 渲染
  page.render();

  console.info('JosekiDiscoverPage 已启动');
}

main().catch(console.error);
