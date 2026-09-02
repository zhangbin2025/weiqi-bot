/**
 * Replay 打印预览页面
 * @description 从 sessionStorage 读取当前局面，渲染多份缩略图供打印
 */

import { BoardCanvasRenderer } from '../shared/print/BoardCanvasRenderer';
import { PrintManager } from '../shared/print/PrintManager';

interface PrintPosition {
  stones: Array<{ x: number; y: number; color: 'black' | 'white' }>;
  lastMove?: { x: number; y: number; color: 'black' | 'white' };
  blackName: string;
  whiteName: string;
  moveNumber: number;
}

function loadData(): PrintPosition | null {
  try {
    const raw = sessionStorage.getItem('replay-print-data');
    if (!raw) return null;
    return JSON.parse(raw) as PrintPosition;
  } catch {
    return null;
  }
}

function renderGrid(data: PrintPosition, rows: number, cols: number): void {
  const container = document.getElementById('thumbnails');
  if (!container) return;

  container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  const total = rows * cols;
  const CANVAS_SIZE = 600;

  for (let i = 0; i < total; i++) {
    const card = document.createElement('div');
    card.className = 'thumbnail-card';

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    canvas.style.width = '300px';
    canvas.style.height = 'auto';

    BoardCanvasRenderer.render(canvas, data.stones, {
      lastMove: data.lastMove,
    });

    const title = document.createElement('div');
    title.className = 'thumbnail-title';
    title.innerHTML = `<span style="color:#000">●</span>${data.blackName} vs <span style="color:#000">○</span>${data.whiteName} (第${data.moveNumber}手)`;

    card.appendChild(canvas);
    card.appendChild(title);
    container.appendChild(card);
  }
}

function main(): void {
  const data = loadData();
  if (!data) {
    const container = document.getElementById('thumbnails');
    if (container) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">没有可打印的棋盘数据</div>';
    }
    return;
  }

  // 检测是否支持打印
  const canPrint = typeof window.print === 'function';
  const printBtn = document.getElementById('printBtn') as HTMLButtonElement;
  const appHint = document.getElementById('appHint');

  if (!canPrint) {
    printBtn.style.display = 'none';
    appHint?.classList.remove('hidden');
  }

  // 初始渲染
  const rowsInput = document.getElementById('rowsInput') as HTMLInputElement;
  const colsInput = document.getElementById('colsInput') as HTMLInputElement;

  renderGrid(data, parseInt(rowsInput.value, 10), parseInt(colsInput.value, 10));

  // 行列变更时重新渲染
  const rerender = () => {
    const r = Math.max(1, Math.min(10, parseInt(rowsInput.value, 10) || 1));
    const c = Math.max(1, Math.min(10, parseInt(colsInput.value, 10) || 1));
    rowsInput.value = String(r);
    colsInput.value = String(c);
    renderGrid(data, r, c);
  };
  rowsInput.addEventListener('change', rerender);
  colsInput.addEventListener('change', rerender);

  // 打印按钮
  printBtn?.addEventListener('click', () => {
    PrintManager.print();
  });
}

main();
