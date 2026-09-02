/**
 * 打谱页面入口
 * @description 棋谱查看器，支持主分支、变化分支、试下模式
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { ReplayPage } from '../../../presentation/adapters/web/pages/replay';
import { createReplayDeps } from '../shared/deps/replay';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  const { replayApp } = await createReplayDeps(ctx);

  const page = new ReplayPage({
    replayApp,
    logger: ctx.logger,
    onNavigate: (pageId: string) => {
      // 导航到其他页面
      if (pageId === 'home') {
        window.location.replace('../index.html');
      } else if (pageId === 'fetcher') {
        window.location.href = '../fetcher/index.html';
      }
    },
  });

  await page.initialize();

  // 监听打印事件
  window.addEventListener('printPosition', async () => {
    const printData = page.getPrintData();
    if (printData.stones.length === 0) {
      alert('当前没有棋盘数据');
      return;
    }
    sessionStorage.setItem('replay-print-data', JSON.stringify(printData));

    // 获取原始棋谱链接，供打印预览生成二维码
    const params = new URLSearchParams(window.location.search);
    // 优先从 URL 参数 src 读取（fetcher 跳转时传入）
    let sourceUrl = params.get('src');
    // 其次从归档 metadata 查询
    if (!sourceUrl) {
      const archiveId = params.get('archiveId');
      if (archiveId) {
        try {
          sourceUrl = await replayApp.getArchiveUrl(archiveId);
        } catch (e) {
          console.warn('获取原始链接失败', e);
        }
      }
    }
    // fallback: 没有原始链接就用当前 replay 页面 URL
    sessionStorage.setItem('replay-print-source-url', sourceUrl ?? window.location.href);

    window.location.href = './print-preview.html';
  });

  // 从 URL 参数加载数据
  const params = new URLSearchParams(window.location.search);
  
  // 解析 move 参数（跳转到指定手数）
  const moveParam = params.get('move');
  const defaultMove = moveParam ? parseInt(moveParam, 10) : undefined;
  
  // 支持 ?sessionId=<id> 从会话加载
  if (params.get('sessionId')) {
    try {
      const sessionId = params.get('sessionId')!;
      const sgfContent = await replayApp.loadBySessionId(sessionId);
      if (sgfContent) {
        page.loadFromSGF(sgfContent, defaultMove !== undefined ? { defaultMove } : undefined);
      }
    } catch (e) {
      console.error('会话加载失败', e instanceof Error ? e : new Error(String(e)));
    }
  }
  
  // 支持 ?archiveId=<id> 从归档加载
  if (params.get('archiveId')) {
    try {
      const archiveId = params.get('archiveId')!;
      const sgfContent = await replayApp.loadByArchiveId(archiveId);
      if (sgfContent) {
        page.loadFromSGF(sgfContent, defaultMove !== undefined ? { defaultMove } : undefined);
      }
    } catch (e) {
      console.error('归档加载失败', e instanceof Error ? e : new Error(String(e)));
    }
  }
  
  // 支持 ?sgf=<base64> 加载 SGF 内容
  if (params.get('sgf')) {
    try {
      const base64Str = params.get('sgf')!;
      const sgfContent = decodeURIComponent(escape(atob(base64Str)));
      page.loadFromSGF(sgfContent, defaultMove !== undefined ? { defaultMove } : undefined);
    } catch (e) {
      console.error('SGF 参数解析失败', e instanceof Error ? e : new Error(String(e)));
    }
  }
}

main().catch(console.error);
