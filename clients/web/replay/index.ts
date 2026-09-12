/**
 * 打谱页面入口
 * @description 棋谱查看器，支持主分支、变化分支、试下模式
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { ReplayPage } from '../../../presentation/adapters/web/pages/replay';
import { createReplayDeps } from '../shared/deps/replay';

/**
 * 简单 hash 函数（djb2），用于收藏 key 去重
 */
function positionHash(content: string, move: number): string {
  const str = content + '|' + move;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 显示 toast 提示
 */
function showToast(message: string, linkText?: string, linkHref?: string) {
  const existing = document.getElementById('replay-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'replay-toast';
  toast.style.cssText = [
    'position: fixed',
    'top: 50%',
    'left: 50%',
    'transform: translate(-50%, -50%)',
    'background: rgba(0,0,0,0.8)',
    'color: white',
    'padding: 16px 24px',
    'border-radius: 12px',
    'font-size: 14px',
    'z-index: 99999',
    'opacity: 0',
    'transition: opacity 0.3s',
    'text-align: center',
    'max-width: 300px',
    'pointer-events: auto'
  ].join(';');
  
  let html = '';
  const div = document.createElement('div');
  div.textContent = message;
  html += div.innerHTML;
  if (linkText && linkHref) {
    html += '<br><a href="' + linkHref + '" style="color:#8ab4ff;text-decoration:underline;display:block;margin-top:8px;">' + linkText + '</a>';
  }
  toast.innerHTML = html;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  const { replayApp } = await createReplayDeps(ctx);

  const page = new ReplayPage({
    replayApp,
    logger: ctx.logger,
    onNavigate: (pageId: string) => {
      if (pageId === 'home') {
        window.location.replace('../index.html');
      } else if (pageId === 'fetcher') {
        window.location.href = '../fetcher/index.html';
      }
    },
  });

  await page.initialize();

  /**
   * 获取当前局面的二维码内容（URL 或精简 SGF）
   */
  async function getQrContent(): Promise<{ content: string; type: 'url' | 'sgf' }> {
    const params = new URLSearchParams(window.location.search);
    let qrContent: string | null = params.get('src');
    if (!qrContent) {
      const archiveId = params.get('archiveId');
      if (archiveId) {
        try {
          qrContent = await replayApp.getArchiveUrl(archiveId);
        } catch (e) {
          console.warn('获取原始链接失败', e);
        }
      }
    }
    if (qrContent && qrContent.startsWith('archive:')) {
      qrContent = null;
    }
    if (!qrContent) {
      qrContent = page.getCompactSgf() ?? '';
      return { content: qrContent, type: 'sgf' };
    }
    const printData = page.getPrintData();
    const moveNumber = printData.moveNumber;
    if (moveNumber > 0) {
      try {
        const url = new URL(qrContent);
        url.searchParams.set('wqmove', String(moveNumber));
        qrContent = url.toString();
      } catch {
        // 不是合法 URL，跳过
      }
    }
    return { content: qrContent, type: 'url' };
  }

  // 监听打印事件
  window.addEventListener('printPosition', async () => {
    const printData = page.getPrintData();
    if (printData.stones.length === 0) {
      alert('当前没有棋盘数据');
      return;
    }
    sessionStorage.setItem('replay-print-data', JSON.stringify(printData));
    const { content } = await getQrContent();
    sessionStorage.setItem('replay-print-source-url', content);
    window.location.href = './print-preview.html';
  });

  // 监听收藏局面事件
  window.addEventListener('favoritePosition', async () => {
    const printData = page.getPrintData();
    if (printData.stones.length === 0) {
      showToast('当前没有棋盘数据');
      return;
    }

    try {
      const { content, type } = await getQrContent();
      const params = new URLSearchParams(window.location.search);
      const archiveId = params.get('archiveId') ?? undefined;
      const key = positionHash(content, printData.moveNumber);
      const existing = await ctx.favoriteService.getFavorite('position', key);

      const favData = {
        qrContent: content,
        qrType: type,
        archiveId,
        source: archiveId ? 'archive' : 'session',
        blackName: printData.blackName,
        whiteName: printData.whiteName,
        moveNumber: printData.moveNumber,
        turn: printData.turn,
        stones: printData.stones,
        lastMove: printData.lastMove,
        size: printData.size,
        viewBox: printData.viewBox,
        labels: printData.labels,
      };

      await ctx.favoriteService.addFavorite('position', key, favData);
      showToast(
        existing ? '已更新收藏' : '收藏成功',
        '查看收藏',
        './favorites.html'
      );
    } catch (e) {
      console.error('收藏失败', e);
      showToast('收藏失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  });

  // 从 URL 参数加载数据
  const params = new URLSearchParams(window.location.search);
  const moveParam = params.get('move');
  const defaultMove = moveParam ? parseInt(moveParam, 10) : undefined;

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
