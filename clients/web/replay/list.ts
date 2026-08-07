/**
 * 棋谱列表页面入口
 * @description Web Shell 棋谱列表页面 - 通过 Provider 加载数据
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { GamesListPage } from '../../../presentation/adapters/web/pages/common';
import { OpponentGameListProvider } from '../../../presentation/adapters/web/pages/common/OpponentGameListProvider';
import { RecorderGameListProvider } from '../../../presentation/adapters/web/pages/common/RecorderGameListProvider';
import { PlayGameListProvider } from '../../../presentation/adapters/web/pages/common/PlayGameListProvider';
import { ReviewGameListProvider } from '../../../presentation/adapters/web/pages/common/ReviewGameListProvider';
import { createGameDeps } from '../shared/deps/game';

async function main() {
  // 1. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  // 2. 创建 providers Map
  const providers = new Map();
  providers.set('opponent', new OpponentGameListProvider(ctx.favoriteService));
  providers.set('recorder', new RecorderGameListProvider(ctx.favoriteService));
  providers.set('play', new PlayGameListProvider(ctx.favoriteService));
  providers.set('review', new ReviewGameListProvider(ctx.favoriteService));

  // 3. 创建 gameService（使用 createGameDeps）
  const { gameService } = await createGameDeps(ctx);

  // 4. 创建页面
  const page = new GamesListPage({
    readMarkService: ctx.readMarkService,
    category: 'opponent_games',
    providers,
    gameService,
    gameHistoryStorage: ctx.gameHistoryStorage,  // 可选，用于显示元数据
    onNavigate: (pageId, params) => {
      if (pageId === 'replay') {
        const searchParams = new URLSearchParams();
        
        if (params && params['archiveId']) {
          searchParams.set('archiveId', params['archiveId']);
          window.location.href = `index.html?${searchParams.toString()}`;
        }
      } else if (pageId === 'review') {
        // 跳转到复盘页面
        const searchParams = new URLSearchParams();
        
        if (params && params['archiveId']) {
          searchParams.set('archiveId', params['archiveId']);
          window.location.href = `../review/index.html?${searchParams.toString()}`;
        }
      }
    },
    onItemClick: (game) => {
      // 获取 URL 参数判断当前类别
      const urlParams = new URLSearchParams(window.location.search);
      const category = urlParams.get('category');
      
      if (category === 'review' && game.archiveId) {
        // 复盘历史条目跳转到复盘页面
        window.location.href = `../review/index.html?archiveId=${game.archiveId}`;
        return true; // 已处理，阻止默认逻辑
      }
      // 其他类别返回 false，继续执行默认跳转逻辑
      return false;
    },
  });

  // 5. 初始化
  await page.initialize();

  // 6. 处理 URL 参数
  const urlParams = new URLSearchParams(window.location.search);
  const category = urlParams.get('category');
  const key = urlParams.get('key');
  const userId = urlParams.get('userId');  // 当前用户ID

  if (category && key) {
    // 新方式：通过 category 和 key 从 provider 加载
    await page.loadGames(category, key, userId || undefined);
  } else {
    // 旧方式：兼容 gamesJson 参数
    const params: Record<string, string> = {};
    urlParams.forEach((value, key) => {
      params[key] = value;
    });
    page.handleParams(params);
  }

  // 7. 渲染
  page.render();

  console.info('GamesListPage 已启动');

  // 8. 监听 pageshow 事件，当页面从 bfcache 恢复时重新渲染
  window.addEventListener('pageshow', async (event) => {
    if (event.persisted) {
      await page.refreshReadMarks();
    }
  });
}

main().catch(console.error);
