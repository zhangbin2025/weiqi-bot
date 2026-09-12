/**
 * 收藏局面页面 — A4 打印布局
 * @description 像 print-preview 一样的 A4 纸布局，行×列可调
 * 支持分页延迟加载、多选删除、多选打印
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { BoardCanvasRenderer } from '../shared/print/BoardCanvasRenderer';
import { PrintManager } from '../shared/print/PrintManager';
import type { IFavoriteItem } from '../../../services/favorite/IFavoriteService';

interface PositionFavoriteData {
  qrContent: string;
  qrType: 'url' | 'sgf';
  archiveId?: string;
  source?: string;
  blackName: string;
  whiteName: string;
  moveNumber: number;
  turn: 'black' | 'white';
  stones: Array<{ x: number; y: number; color: 'black' | 'white' }>;
  lastMove?: { x: number; y: number; color: 'black' | 'white' };
  size?: number;
  viewBox?: { minX: number; minY: number; width: number; height: number };
  labels?: Array<{ x: number; y: number; letter: string }>;
}

declare global {
  interface Window {
    QRCode?: new (container: HTMLElement, options: {
      width: number;
      height: number;
      colorDark: string;
      colorLight: string;
      correctLevel?: number;
    }) => { makeCode(content: string): void; clear(): void };
  }
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + '分前';
  if (hours < 24) return hours + '小时前';
  if (days < 30) return days + '天前';
  const date = new Date(timestamp);
  return (date.getMonth() + 1) + '/' + date.getDate();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderQRCode(container: HTMLElement, content: string): void {
  if (!content || !window.QRCode) {
    container.style.display = 'none';
    return;
  }
  container.innerHTML = '';
  try {
    const correctLevel = window.QRCode.CorrectLevel
      ? window.QRCode.CorrectLevel.M
      : 0;
    const qr = new window.QRCode(container, {
      width: 120,
      height: 120,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel,
    });
    qr.makeCode(content);
  } catch (e) {
    console.error('QR code generation failed:', e);
    container.style.display = 'none';
  }
}

/** 创建单个卡片 DOM */
function createCard(
  item: IFavoriteItem,
  selectedIds: Set<string>,
  onCardClick: (item: IFavoriteItem) => void
): HTMLElement {
  const data = item.data as PositionFavoriteData | undefined;

  const card = document.createElement('div');
  card.className = 'thumbnail-card';

  if (!data || !data.stones) {
    card.style.visibility = 'hidden';
    return card;
  }

  if (selectedIds.has(item.id)) card.classList.add('selected');
  card.dataset.id = item.id;

  // 信息 + 二维码（二维码在左，文字在右，放在棋盘上方）
  const footer = document.createElement('div');
  footer.className = 'card-footer';

  // 二维码（左侧）
  const qrWrap = document.createElement('div');
  qrWrap.className = 'card-footer-qr';
  const qrContainer = document.createElement('div');
  qrWrap.appendChild(qrContainer);
  renderQRCode(qrContainer, data.qrContent);
  footer.appendChild(qrWrap);

  // 文字信息（右侧）
  const footerText = document.createElement('div');
  footerText.className = 'card-footer-text';
  const playersDiv = document.createElement('div');
  playersDiv.className = 'card-footer-players';
  playersDiv.innerHTML = '<span style="color:#000">●</span>' + escapeHtml(data.blackName) +
    ' vs <span style="color:#000">○</span>' + escapeHtml(data.whiteName);
  footerText.appendChild(playersDiv);

  const metaDiv = document.createElement('div');
  metaDiv.className = 'card-footer-meta';
  const turnText = data.turn === 'black' ? '黑先' : '白先';
  const moveText = data.moveNumber > 0 ? '第' + data.moveNumber + '手' : '初始';
  metaDiv.textContent = formatRelativeTime(item.createdAt) + ' · ' + turnText + ' · ' + moveText;
  footerText.appendChild(metaDiv);
  footer.appendChild(footerText);
  card.appendChild(footer);

  // 棋盘（放在信息下方）
  const canvas = document.createElement('canvas');
  canvas.className = 'board-canvas';
  canvas.width = 600;
  canvas.height = 600;
  BoardCanvasRenderer.render(canvas, data.stones, {
    lastMove: data.lastMove,
    size: data.size,
    viewBox: data.viewBox,
  });
  card.appendChild(canvas);

  // 多选勾选
  const checkbox = document.createElement('div');
  checkbox.className = 'select-checkbox';
  checkbox.textContent = '✓';
  card.appendChild(checkbox);

  card.addEventListener('click', () => onCardClick(item));
  return card;
}

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  const pagesContainer = document.getElementById('pagesContainer')!;
  const emptyState = document.getElementById('emptyState')!;
  const selectModeBtn = document.getElementById('selectModeBtn')!;
  const deleteBtn = document.getElementById('deleteBtn') as HTMLButtonElement;
  const printBtn = document.getElementById('printBtn')!;
  const bottomBar = document.getElementById('bottomBar')!;
  const bottomBarInfo = document.getElementById('bottomBarInfo')!;
  const cancelSelectBtn = document.getElementById('cancelSelectBtn')!;
  const printSelectedBtn = document.getElementById('printSelectedBtn') as HTMLButtonElement;
  const appHint = document.getElementById('appHint')!;
  const rowsInput = document.getElementById('rowsInput') as HTMLInputElement;
  const colsInput = document.getElementById('colsInput') as HTMLInputElement;
  const loadMore = document.getElementById('loadMore')!;

  let favorites: IFavoriteItem[] = [];
  let multiSelectMode = false;
  let selectedIds: Set<string> = new Set();
  let renderedCount = 0;       // 已渲染的卡片数
  const PAGE_SIZE = 12;        // 每次加载的卡片数（延迟渲染）

  const canPrint = typeof window.print === 'function';
  if (!canPrint) {
    printBtn.style.display = 'none';
    printSelectedBtn.style.display = 'none';
    appHint.classList.remove('hidden');
  }

  async function loadFavorites() {
    try {
      favorites = await ctx.favoriteService.getFavorites({ category: 'position' });
      renderedCount = 0;
      render();
    } catch (e) {
      console.error('加载收藏失败', e);
      favorites = [];
      render();
    }
  }

  function getGridConfig() {
    const rows = Math.max(1, Math.min(10, parseInt(rowsInput.value, 10) || 2));
    const cols = Math.max(1, Math.min(10, parseInt(colsInput.value, 10) || 2));
    rowsInput.value = String(rows);
    colsInput.value = String(cols);
    return { rows, cols, perPage: rows * cols };
  }

  function render() {
    const { rows, cols, perPage } = getGridConfig();

    if (favorites.length === 0) {
      emptyState.style.display = 'block';
      pagesContainer.innerHTML = '';
      selectModeBtn.style.display = 'none';
      deleteBtn.style.display = 'none';
      printBtn.style.display = 'none';
      const configGroup = document.querySelector('.config-group') as HTMLElement;
      if (configGroup) configGroup.style.display = 'none';
      loadMore.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    selectModeBtn.style.display = canPrint ? 'flex' : 'none';
    deleteBtn.style.display = 'flex';
    printBtn.style.display = canPrint ? 'flex' : 'none';
    const configGroup = document.querySelector('.config-group') as HTMLElement;
    if (configGroup) configGroup.style.display = 'flex';

    pagesContainer.innerHTML = '';
    renderedCount = 0;
    renderNextPage();
  }

  function renderNextPage() {
    const { rows, cols, perPage } = getGridConfig();
    const toRender = Math.min(perPage, favorites.length - renderedCount);

    if (toRender <= 0) {
      loadMore.style.display = 'none';
      return;
    }

    // 创建一个 A4 页面
    const page = document.createElement('div');
    page.className = 'a4-page';
    const grid = document.createElement('div');
    grid.className = 'thumbnail-grid';
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    grid.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';

    for (let i = 0; i < toRender; i++) {
      const item = favorites[renderedCount];
      const card = createCard(item, selectedIds, onCardClick);
      grid.appendChild(card);
      renderedCount++;
    }

    page.appendChild(grid);
    pagesContainer.appendChild(page);

    // 还有更多？
    if (renderedCount < favorites.length) {
      loadMore.style.display = 'block';
      // 延迟加载下一页
      setTimeout(() => renderNextPage(), 100);
    } else {
      loadMore.style.display = 'none';
    }
  }

  function onCardClick(item: IFavoriteItem) {
    if (multiSelectMode) {
      if (selectedIds.has(item.id)) {
        selectedIds.delete(item.id);
      } else {
        selectedIds.add(item.id);
      }
      // 更新所有同名卡片的选中状态
      pagesContainer.querySelectorAll('.thumbnail-card').forEach(card => {
        const id = (card as HTMLElement).dataset.id;
        if (id === item.id) {
          if (selectedIds.has(item.id)) {
            card.classList.add('selected');
          } else {
            card.classList.remove('selected');
          }
        }
      });
      updateButtons();
    } else {
      openPosition(item);
    }
  }

  function openPosition(item: IFavoriteItem) {
    const data = item.data as PositionFavoriteData;
    const moveParam = data.moveNumber > 0 ? '&move=' + data.moveNumber : '';
    if (data.archiveId) {
      window.location.href = 'index.html?archiveId=' + encodeURIComponent(data.archiveId) + moveParam;
    } else if (data.qrType === 'sgf' && data.qrContent) {
      const sessionId = 'fav-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      ctx.sessionStorageService.set(sessionId, { sgf: data.qrContent }).then(() => {
        window.location.href = 'index.html?sessionId=' + sessionId + moveParam;
      });
    } else if (data.qrType === 'url' && data.qrContent) {
      window.location.href = data.qrContent;
    }
  }

  function updateButtons() {
    const count = selectedIds.size;
    bottomBarInfo.textContent = '已选 ' + count + ' 个';
    printSelectedBtn.disabled = count === 0;
    deleteBtn.disabled = count === 0;
  }

  function setMultiSelectMode(on: boolean) {
    multiSelectMode = on;
    if (on) {
      document.body.classList.add('multi-select-mode');
      selectModeBtn.textContent = '取消多选';
      selectModeBtn.classList.add('active');
      bottomBar.classList.add('visible');
      printBtn.textContent = '🖨️ 打印选中';
      selectedIds.clear();
      pagesContainer.querySelectorAll('.thumbnail-card').forEach(c => c.classList.remove('selected'));
    } else {
      document.body.classList.remove('multi-select-mode');
      selectModeBtn.textContent = '☑️ 多选';
      selectModeBtn.classList.remove('active');
      bottomBar.classList.remove('visible');
      printBtn.textContent = '🖨️ 打印';
      selectedIds.clear();
      pagesContainer.querySelectorAll('.thumbnail-card').forEach(c => c.classList.remove('selected'));
    }
    updateButtons();
  }

  /** 打印 — 多选模式下打印选中，否则打印全部 */
  function handlePrint() {
    if (multiSelectMode && selectedIds.size > 0) {
      printSelected();
    } else {
      PrintManager.print();
    }
  }

  /** 打印选中的 — 只显示选中卡片，隐藏其他 */
  function printSelected() {
    if (selectedIds.size === 0) return;

    const allPages = pagesContainer.querySelectorAll('.a4-page');
    const hiddenElements: HTMLElement[] = [];

    allPages.forEach(page => {
      const cards = page.querySelectorAll('.thumbnail-card');
      let hasSelected = false;
      cards.forEach(card => {
        const id = (card as HTMLElement).dataset.id;
        if (id && selectedIds.has(id)) {
          hasSelected = true;
        } else {
          // 所有未选中的（包括空占位卡片）都隐藏
          hiddenElements.push(card as HTMLElement);
          (card as HTMLElement).style.display = 'none';
        }
      });
      if (!hasSelected) {
        hiddenElements.push(page as HTMLElement);
        (page as HTMLElement).style.display = 'none';
      }
    });

    const cleanup = () => {
      hiddenElements.forEach(el => { el.style.display = ''; });
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    const fallbackTimer = setTimeout(cleanup, 3000);
    window.addEventListener('afterprint', () => clearTimeout(fallbackTimer));

    PrintManager.print();
  }

  /** 删除选中的 */
  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm('确定删除选中的 ' + selectedIds.size + ' 个收藏？')) return;
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await ctx.favoriteService.removeFavorite(id);
    }
    selectedIds.clear();
    setMultiSelectMode(false);
    await loadFavorites();
  }

  // 行列变更 — 重新渲染
  const rerender = () => {
    renderedCount = 0;
    pagesContainer.innerHTML = '';
    render();
  };
  rowsInput.addEventListener('change', rerender);
  colsInput.addEventListener('change', rerender);

  // 按钮事件
  selectModeBtn.addEventListener('click', () => setMultiSelectMode(!multiSelectMode));
  deleteBtn.addEventListener('click', () => deleteSelected());
  cancelSelectBtn.addEventListener('click', () => setMultiSelectMode(false));
  printBtn.addEventListener('click', () => handlePrint());
  printSelectedBtn.addEventListener('click', () => printSelected());

  await loadFavorites();
}

main().catch(console.error);
