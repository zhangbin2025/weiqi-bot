/**
 * 打谱页面入口
 * @description 棋谱查看器，支持主分支、变化分支、试下模式
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { ReplayPage } from '../../../presentation/adapters/web/pages/replay';
import { createReplayDeps } from '../shared/deps/replay';
import { SessionStorageAdapter } from '../../../infrastructure/storage/adapters/web/SessionStorageAdapter';
import Dialog from '../shared/ui/Dialog';

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
interface ToastLink {
  text: string;
  onClick: () => void;
}

type ToastType = 'success' | 'error' | 'info';

/** 各类 toast 的配色与图标 */
const TOAST_STYLE: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: 'rgba(22, 101, 52, 0.96)', border: '#4ade80', icon: '✓' },
  error:   { bg: 'rgba(153, 27, 27, 0.96)', border: '#f87171', icon: '✕' },
  info:    { bg: 'rgba(0, 0, 0, 0.82)',      border: 'rgba(255,255,255,0.25)', icon: 'ℹ' },
};

function showToast(message: string, type: ToastType = 'info', links?: ToastLink[], persist: boolean = false, duration?: number): void {
  const existing = document.getElementById('replay-toast');
  if (existing) existing.remove();

  const st = TOAST_STYLE[type] || TOAST_STYLE.info;

  const toast = document.createElement('div');
  toast.id = 'replay-toast';
  toast.style.cssText = [
    'position: fixed',
    'top: 50%',
    'left: 50%',
    'transform: translate(-50%, -50%)',
    'background: ' + st.bg,
    'color: white',
    'padding: 18px 28px',
    'border-radius: 14px',
    'border: 2px solid ' + st.border,
    'box-shadow: 0 8px 30px rgba(0,0,0,0.4)',
    'font-size: 16px',
    'font-weight: 600',
    'z-index: 99999',
    'opacity: 0',
    'transition: opacity 0.3s',
    'text-align: center',
    'max-width: 320px',
    'pointer-events: auto',
    'display: flex',
    'flex-direction: column',
    'align-items: center',
    'gap: 4px'
  ].join(';');

  // 图标 + 文案
  const mainRow = document.createElement('div');
  mainRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

  const iconEl = document.createElement('span');
  iconEl.textContent = st.icon;
  iconEl.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'width:26px',
    'height:26px',
    'border-radius:50%',
    'background:' + st.border,
    'color:#fff',
    'font-size:16px',
    'font-weight:bold',
    'flex-shrink:0'
  ].join(';');

  const textEl = document.createElement('span');
  textEl.textContent = message;

  mainRow.appendChild(iconEl);
  mainRow.appendChild(textEl);
  toast.appendChild(mainRow);

  if (links && links.length > 0) {
    const linkWrap = document.createElement('div');
    linkWrap.style.cssText = 'margin-top:10px;display:flex;gap:20px;justify-content:center;';
    for (const lk of links) {
      const a = document.createElement('a');
      a.textContent = lk.text;
      a.href = 'javascript:void(0)';
      a.style.cssText = 'color:#fff;text-decoration:underline;font-size:15px;font-weight:500;';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        toast.remove();
        lk.onClick();
      });
      linkWrap.appendChild(a);
    }
    toast.appendChild(linkWrap);
  }

  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });

  // 停留时间：有链接时更长，便于用户点击；persist=true 时不自动消失（需用户点击链接/关闭）
  if (persist) return;
  const ms = duration ?? ((links && links.length > 0) ? 8000 : 5000);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, ms);
}

const sessionStore = new SessionStorageAdapter('weiqi-bot');

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  await sessionStore.initialize();
  const { replayApp } = await createReplayDeps(ctx);

  const page = new ReplayPage({
    replayApp,
    onNavigate: (pageId: string) => {
      if (pageId === 'home') {
        window.location.replace('../index.html');
      } else if (pageId === 'fetcher') {
        window.location.href = '../fetcher/index.html';
      }
    },
    onPassMove: (moveNumber, color) => {
      // 浏览到停一手（脱先）着法时弹出提示
      const side = color === 'black' ? '黑方' : '白方';
      const hand = moveNumber > 0 ? `第 ${moveNumber} 手 · ` : '';
      showToast(`${hand}${side}脱先（停一手）`, 'info', undefined, false, 2000);
    },
  });

  await page.initialize();

  // 做题模式下点击「查看棋谱」：退出做题，进入常规打谱
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
      await Dialog.alert('当前没有棋盘数据');
      return;
    }
    await sessionStore.write('replay-print-data', printData);
    const { content } = await getQrContent();
    await sessionStore.write('replay-print-source-url', content);
    window.location.href = './print-preview.html';
  });

  // 监听收藏局面事件
  window.addEventListener('favoritePosition', async () => {
    const printData = page.getPrintData();
    if (printData.stones.length === 0) {
      showToast('当前没有棋盘数据', 'info');
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
        labels: page.getSuggestedMoves() ?? printData.labels,
      };

      await ctx.favoriteService.addFavorite('position', key, favData);
      showToast(
        existing ? '已更新收藏' : '收藏成功',
        'success',
        [{ text: '查看收藏', onClick: () => { window.location.href = './favorites.html'; } }]
      );
    } catch (e) {
      console.error('收藏失败', e);
      showToast('收藏失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
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
      // 检查归档棋谱是否有源 URL，有则启用棋谱链接菜单项
      try {
        const sourceUrl = await replayApp.getArchiveUrl(archiveId);
        if (sourceUrl && !sourceUrl.startsWith("archive:") && (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://"))) {
          const sourceLinkItem = document.getElementById('sourceLinkMenuItem');
          if (sourceLinkItem) {
            sourceLinkItem.removeAttribute('disabled');
            sourceLinkItem.style.opacity = '';
            sourceLinkItem.style.cursor = '';
            sourceLinkItem.addEventListener('click', (e) => {
              e.stopPropagation();
              document.getElementById('dropdownMenu')?.classList.remove('visible');
              window.open(sourceUrl, '_blank');
            });
          }
        }
      } catch (e) {
        console.warn('获取棋谱源链接失败', e);
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
