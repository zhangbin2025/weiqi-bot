/**
 * 定式列表页面入口
 * @description Web Shell 定式列表页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { JosekiListPage } from '../../../presentation/adapters/web/pages/common';
import { createGameDeps } from '../shared/deps/game';
import { JosekiDiscoverProvider } from '../../../presentation/adapters/web/pages/common/JosekiDiscoverProvider';
import { OpponentJosekiListProvider } from '../../../presentation/adapters/web/pages/common/OpponentJosekiListProvider';
import { SessionService } from '../../../services/session';

const SCROLL_KEY = 'joseki_list_scroll_to';
const LAST_VIEWED_KEY = 'joseki_last_viewed_id';

/**
 * 滚动并高亮指定定式卡片
 */
function scrollToPattern(patternId: string): void {
  const card = document.querySelector(`.joseki-card[data-id="${patternId}"]`);
  if (card) {
    // 滚动到卡片（居中显示）
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // 添加高亮动画
    card.classList.add('highlight');
    // 3秒后移除高亮
    setTimeout(() => card.classList.remove('highlight'), 3000);
    // 清除标记
    sessionStorage.removeItem(SCROLL_KEY);
  }
}

/**
 * 检查并执行滚动定位
 */
function checkAndScroll(): void {
  const patternId = sessionStorage.getItem(SCROLL_KEY);
  if (patternId) {
    // 等待渲染完成
    setTimeout(() => scrollToPattern(patternId), 100);
  }
}

/**
 * 存储最后查看的卡片ID
 */
function storeLastViewedId(patternId: string): void {
  sessionStorage.setItem(LAST_VIEWED_KEY, patternId);
}

async function main() {
  // 1. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  // 2. 使用全局收藏服务
  const favoriteService = ctx.favoriteService;

  // 3. 创建棋谱服务（带归档存储）
  const { gameService } = await createGameDeps(ctx);

  // 4. 创建会话服务
  const cacheStorage = ctx.createCacheStorage();
  await cacheStorage.initialize();
  const sessionService = new SessionService(cacheStorage);

  // 5. 创建数据提供者注册表
  const providers = new Map();
  providers.set('joseki_discover', new JosekiDiscoverProvider(favoriteService));
  providers.set('opponent', new OpponentJosekiListProvider(favoriteService));

  // 6. 创建页面
  const page = new JosekiListPage({
    readMarkService: ctx.readMarkService,
    providers,
    gameService,
    onNavigate: async (pageId, params) => {
      // 在跳转前，检查是否有最后查看的卡片ID
      const lastViewedId = sessionStorage.getItem(LAST_VIEWED_KEY);
      if (lastViewedId) {
        // 转移到滚动标记
        sessionStorage.setItem(SCROLL_KEY, lastViewedId);
        sessionStorage.removeItem(LAST_VIEWED_KEY);
      }
      
      if (pageId === 'joseki/explore') {
        window.location.href = `explore.html?${new URLSearchParams(params).toString()}`;
      } else if (pageId === 'replay') {
        const searchParams = new URLSearchParams();
        // 优先使用 archiveId
        if (params && params['archiveId']) {
          searchParams.set('archiveId', params['archiveId']);
        } else if (params && params['sgf']) {
          // 通过 Session 服务传递 SGF
          const sessionId = await sessionService.create('replay', { sgf: params['sgf'] });
          searchParams.set('sessionId', sessionId);
        }
        if (params && params['move']) {
          searchParams.set('move', params['move']);
        }
        window.location.href = `../replay/index.html?${searchParams.toString()}`;
      }
    },
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

  // 10. 检查是否需要滚动定位
  checkAndScroll();

  // 11. 监听卡片点击事件（事件委托）
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest('.joseki-card');
    if (card) {
      const patternId = card.getAttribute('data-id');
      if (patternId) {
        storeLastViewedId(patternId);
      }
    }
  }, true); // 使用捕获阶段，确保在 renderer 的事件之前触发

  console.info('JosekiListPage 已启动');

  // 12. 监听 pageshow 事件，当页面从 bfcache 恢复时重新渲染
  window.addEventListener('pageshow', async (event) => {
    if (event.persisted) {
      await page.refreshReadMarks();
      // 重新检查滚动定位
      checkAndScroll();
    }
  });

  // 绑定胜率弹窗关闭事件
  const closeBtn = document.getElementById('winrate-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const backdrop = document.getElementById('winrate-backdrop');
      const sheet = document.getElementById('winrate-sheet');
      if (backdrop) backdrop.classList.remove('active');
      if (sheet) sheet.classList.remove('active');
    });
  }
  const backdropEl = document.getElementById('winrate-backdrop');
  if (backdropEl) {
    backdropEl.addEventListener('click', () => {
      backdropEl.classList.remove('active');
      const sheet = document.getElementById('winrate-sheet');
      if (sheet) sheet.classList.remove('active');
    });
  }
}

main().catch(console.error);
