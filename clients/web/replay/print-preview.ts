/**
 * Replay 打印预览页面
 * @description 从 sessionStorage 读取当前局面，渲染多份缩略图供打印
 * 打印时标题显示一次在头部，右上角显示二维码方便扫码在线查看
 */

import { BoardCanvasRenderer } from '../shared/print/BoardCanvasRenderer';
import { PrintManager } from '../shared/print/PrintManager';

interface PrintPosition {
  stones: Array<{ x: number; y: number; color: 'black' | 'white' }>;
  lastMove?: { x: number; y: number; color: 'black' | 'white' };
  blackName: string;
  whiteName: string;
  moveNumber: number;
  turn: 'black' | 'white';
  size?: number;
  viewBox?: { minX: number; minY: number; width: number; height: number };
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

function loadData(): PrintPosition | null {
  try {
    const raw = sessionStorage.getItem('replay-print-data');
    if (!raw) return null;
    return JSON.parse(raw) as PrintPosition;
  } catch {
    return null;
  }
}

function getSourceUrl(): string | null {
  try {
    return sessionStorage.getItem('replay-print-source-url');
  } catch {
    return null;
  }
}

function renderPrintHeader(data: PrintPosition): void {
  const titleEl = document.getElementById('printHeaderTitle');
  if (!titleEl) return;

  const turnText = data.turn === 'black' ? '黑先' : '白先';
  const moveText = data.moveNumber > 0 ? '第' + data.moveNumber + '手' : '';
  titleEl.innerHTML = '<div class="player-line">' +
    '<span style="color:#000">●</span>' + data.blackName + ' vs ' +
    '<span style="color:#000">○</span>' + data.whiteName + '</div>' +
    '<div class="info-line">' + turnText + (moveText ? ' · ' + moveText : '') + '</div>';
}

function renderQRCode(url: string): void {
  const container = document.getElementById('qrContainer');
  if (!container) return;


  if (!window.QRCode) {
    console.error('QRCode library not loaded');
    container.style.display = 'none';
    return;
  }

  container.innerHTML = '';
  try {
    // 纠错级别 M（15%），比默认 H（30%）能用更小的 QR 版本
    // QRCode.CorrectLevel: L=1, M=0, Q=3, H=2
    const correctLevel = window.QRCode.CorrectLevel
      ? window.QRCode.CorrectLevel.M
      : 0;
    const qr = new window.QRCode(container, {
      width: 400,
      height: 400,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel,
    });
    qr.makeCode(url);
  } catch (e) {
    console.error('QR code generation failed:', e);
    container.style.display = 'none';
  }
}

function renderGrid(data: PrintPosition, rows: number, cols: number): void {
  const container = document.getElementById('thumbnails');
  if (!container) return;

  container.innerHTML = '';
  container.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';

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
      size: data.size,
      viewBox: data.viewBox,
    });

    card.appendChild(canvas);
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

  // 渲染打印头部（标题）
  renderPrintHeader(data);

  // 生成二维码（sourceUrl 已在 replay 页面异步查好存入 sessionStorage）
  const sourceUrl = getSourceUrl();
  if (sourceUrl) {
    renderQRCode(sourceUrl);
  } else {
    const qrContainer = document.getElementById('qrContainer');
    if (qrContainer) qrContainer.style.display = 'none';
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
