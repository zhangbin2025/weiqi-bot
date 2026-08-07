/**
 * 定式探索页面入口
 * @description Web Shell 定式探索页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { JosekiExplorePage } from '../../../presentation/adapters/web/pages/joseki';
import { WebAudioPlayer } from '../../../infrastructure/audio/WebAudioPlayer';
import { JosekiExploreApp } from '../../../application/joseki';
import { JosekiLoader } from '../../../services/joseki/JosekiLoader';
import { JosekiExploreService } from '../../../services/joseki/explore/JosekiExploreService';
import { ReadMarkService } from '../../../services/readmark/ReadMarkService';
import { LocalStorageAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import { READ_MARK_CATEGORIES } from '../../../services/readmark/types';

async function main() {
  // 显示加载遮罩
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.innerHTML = `
    <div class="loading-content">
      <div class="loading-spinner"></div>
      <div class="loading-title">加载定式库</div>
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
      josekiExplore: {
        enableDynamicLoad: false,
      },
    },
  });

  // 2. 创建定式加载器
  const loader = new JosekiLoader(
    ctx.network,
    {
      // 简化的文件存储实现
      async upload(path: string, data: Blob | ArrayBuffer): Promise<void> {
        // 暂不实现本地缓存
      },
      async download(path: string): Promise<Blob> {
        throw new Error('Not cached');
      },
      async delete(path: string): Promise<void> {},
      async exists(path: string): Promise<boolean> { return false; },
      async getMetadata(path: string) { throw new Error('Not implemented'); },
      async readChunk(path: string, start: number, end: number): Promise<ArrayBuffer> { throw new Error('Not implemented'); },
      async listFiles(dirPath: string): Promise<string[]> { return []; },
      async createDirectory(dirPath: string): Promise<void> {},
      async deleteDirectory(dirPath: string, recursive?: boolean): Promise<void> {},
      async initialize(): Promise<void> {},
    },
    ctx.config
  );

  // 预加载所有子树
  updateProgress(5, '加载定式索引...');
  await loader.preloadAllSubtrees((percent, status) => {
    updateProgress(percent, status);
  });

  // 3. 创建定式探索服务
  const exploreService = new JosekiExploreService(loader, ctx.config);

  // 4. 创建定式探索应用
  const exploreApp = new JosekiExploreApp(
    exploreService,
    loader,
    ctx.favoriteService
  );

  // 5. 创建已读标记服务
  const storage = new LocalStorageAdapter('weiqi-joseki');
  await storage.initialize();
  const readMarkService = new ReadMarkService(storage, ctx.logger);

  // 6. 创建音效播放器
  const audioPlayer = new WebAudioPlayer();

  // 7. 创建页面
  const page = new JosekiExplorePage({
    exploreApp,
    readMarkService,
    logger: ctx.logger,
    onNavigate: (pageId, params) => {
      if (pageId === 'joseki/list') {
        window.location.href = `list.html?${new URLSearchParams(params).toString()}`;
      }
    },
    audioPlayer,
  });

  // 7. 初始化
  await page.initialize();

  // 8. 处理 URL 参数
  const urlParams = new URLSearchParams(window.location.search);
  const params: Record<string, string> = {};
  urlParams.forEach((value, key) => {
    params[key] = value;
  });
  page.handleParams(params);

  // 9. 渲染
  page.render();

  // 隐藏加载遮罩
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }, 200);

  console.info('JosekiExplorePage 已启动');
}

main().catch(console.error);
