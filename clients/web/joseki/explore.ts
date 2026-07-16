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

  console.info('JosekiExplorePage 已启动');
}

main().catch(console.error);
