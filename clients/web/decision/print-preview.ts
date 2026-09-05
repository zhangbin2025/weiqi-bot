/**
 * 打印预览页面
 * @description 渲染题目缩略图网格，支持打印
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { coordToPos } from '../../../domain/sgf';
import { Game } from '../../../domain/game';
import { showError } from './problems/utils';
import { BoardCanvasRenderer } from '../shared/print/BoardCanvasRenderer';
import { PrintManager } from '../shared/print/PrintManager';

interface PrintProblem {
  gameId: string;
  gameName: string;
  blackName: string;
  whiteName: string;
  turn: 'B' | 'W';
  problemIndex: number;
  position: Array<{ coord: string; color: 'B' | 'W' }>;
  options: Array<{ coord: string; letter: string }>;
}

/**
 * 解析压缩的 position 字符串
 * 格式: "BqdWdpBpq..." -> [{color: 'B', coord: 'qd'}, {color: 'W', coord: 'dp'}, ...]
 */
function parsePosition(positionStr: string): Array<{ coord: string; color: 'B' | 'W' }> {
  const moves: Array<{ coord: string; color: 'B' | 'W' }> = [];
  for (let i = 0; i < positionStr.length; i += 3) {
    const color = positionStr[i] as 'B' | 'W';
    const coord = positionStr.substring(i + 1, i + 3);
    moves.push({ color, coord });
  }
  return moves;
}

/**
 * 主函数
 */
async function main() {
  const ctx = await WebBootstrap.init({ containerId: 'page-root' });
  const { favoriteService } = ctx;
  const params = new URLSearchParams(window.location.search);

  const favoriteId = params.get('favoriteId');
  const problemIndexes = params.get('indexes');
  const showOptions = localStorage.getItem('quiz-showOptions') !== 'false';

  if (!favoriteId || !problemIndexes) {
    showError('缺少参数');
    return;
  }

  try {
    // 加载题目数据
    const fav = await favoriteService?.getById(favoriteId);
    if (!fav?.data) {
      showError('题目数据不存在');
      return;
    }

    const allProblems = (fav.data['problems'] as any[]) || [];
    const problems = loadProblems(allProblems, problemIndexes.split(',').map(Number));

    // 检测是否支持打印
    const canPrint = typeof window.print === 'function';
    const printBtn = document.getElementById('printBtn') as HTMLButtonElement;
    const appHint = document.getElementById('appHint');

    if (!canPrint) {
      printBtn.style.display = 'none';
      appHint?.classList.remove('hidden');
    }

    // 渲染缩略图
    renderThumbnails(problems, showOptions);

    // 打印按钮
    printBtn?.addEventListener('click', () => {
      PrintManager.print();
    });

  } catch (err) {
    console.error('加载失败:', err);
    showError('加载失败: ' + (err as Error).message);
  }
}

/**
 * 加载题目数据
 */
function loadProblems(allProblems: any[], indexes: number[]): PrintProblem[] {
  const problems = indexes.map(idx => {
    const p = allProblems[idx];
    if (!p) return null;

    const position = typeof p.position === 'string'
      ? parsePosition(p.position)
      : (Array.isArray(p.position) ? p.position : []);

    const options = (p.options || []).map((opt: any, idx: number) => ({
      coord: opt.position || opt.coord || '',
      letter: String.fromCharCode(65 + idx)
    }));

    const meta = p.metadata || {};
    const blackName = meta.playerBlack || '黑棋';
    const whiteName = meta.playerWhite || '白棋';

    return {
      gameId: meta.gameId || p.id || '',
      gameName: meta.gameName || meta.event || '',
      blackName,
      whiteName,
      turn: p.turn || 'B',
      problemIndex: idx,
      position,
      options
    };
  }).filter(Boolean) as PrintProblem[];

  problems.sort((a, b) => {
    if (a.gameId !== b.gameId) {
      return a.gameName.localeCompare(b.gameName);
    }
    return a.position.length - b.position.length;
  });

  return problems;
}

/**
 * 渲染缩略图网格
 */
function renderThumbnails(problems: PrintProblem[], showOptions: boolean): void {
  const container = document.getElementById('thumbnails');
  if (!container) return;

  const THUMBNAIL_SIZE = 600;
  const gameCountMap = new Map<string, number>();
  problems.forEach(p => {
    gameCountMap.set(p.gameId, (gameCountMap.get(p.gameId) || 0) + 1);
  });

  const gameIndexMap = new Map<string, number>();

  let selectedCount = 0;
  const totalCount = problems.length;
  const selectInfo = document.getElementById('selectInfo');
  const selectAllBtn = document.getElementById('selectAllBtn');

  function updateSelectInfo() {
    if (selectInfo) {
      selectInfo.textContent = `已选 ${selectedCount}/${totalCount}`;
    }
  }

  function toggleSelect(card: HTMLElement) {
    card.classList.toggle('selected');
    if (card.classList.contains('selected')) {
      selectedCount++;
    } else {
      selectedCount--;
    }
    updateSelectInfo();
  }

  function selectAll() {
    const cards = document.querySelectorAll('.thumbnail-card');
    const allSelected = selectedCount === totalCount;
    cards.forEach(card => {
      if (allSelected) {
        card.classList.remove('selected');
      } else {
        card.classList.add('selected');
      }
    });
    selectedCount = allSelected ? 0 : totalCount;
    updateSelectInfo();
    if (selectAllBtn) {
      selectAllBtn.textContent = allSelected ? '☐ 全选' : '☑ 取消全选';
    }
  }

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', selectAll);
  }

  for (const problem of problems) {
    const card = document.createElement('div');
    card.className = 'thumbnail-card selected';

    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_SIZE;
    canvas.height = THUMBNAIL_SIZE;
    canvas.style.width = '300px';
    canvas.style.height = 'auto';

    try {
      renderThumbnail(canvas, problem, showOptions);
    } catch (error) {
      console.error('渲染缩略图失败:', error);
    }

    const gameIdx = gameIndexMap.get(problem.gameId) || 0;
    gameIndexMap.set(problem.gameId, gameIdx + 1);

    const title = document.createElement('div');
    title.className = 'thumbnail-title';
    const turnText = problem.turn === 'B' ? '黑先' : '白先';

    if (gameCountMap.get(problem.gameId) === 1) {
      title.innerHTML = `<span style="color:#000">●</span>${problem.blackName} vs <span style="color:#000">○</span>${problem.whiteName} (${turnText})`;
    } else {
      title.innerHTML = `<span style="color:#000">●</span>${problem.blackName} vs <span style="color:#000">○</span>${problem.whiteName} (${turnText}) - 第${gameIdx + 1}题`;
    }

    const checkbox = document.createElement('div');
    checkbox.className = 'select-checkbox';
    card.appendChild(checkbox);

    card.addEventListener('click', () => toggleSelect(card));

    card.appendChild(canvas);
    card.appendChild(title);
    container.appendChild(card);
  }

  // 初始化：全部选中
  selectedCount = totalCount;
  updateSelectInfo();
  if (selectAllBtn) {
    selectAllBtn.textContent = '☑ 取消全选';
  }
}

/**
 * 渲染单个缩略图（使用公共 BoardCanvasRenderer）
 */
function renderThumbnail(
  canvas: HTMLCanvasElement,
  problem: PrintProblem,
  showOptions: boolean
): void {
  // 使用 Game 类重建棋盘（自动处理提子）
  const game = new Game({ size: 19 });

  for (const move of problem.position) {
    const pos = coordToPos(move.coord);
    if (pos) {
      game.placeStone(pos.x, pos.y);
    }
  }

  const stones = game.getBoard().getAllStones().map(s => ({
    x: s.x,
    y: s.y,
    color: s.color,
  }));

  // 最后一手
  let lastMove: { x: number; y: number; color: 'black' | 'white' } | undefined;
  if (problem.position.length > 0) {
    const last = problem.position[problem.position.length - 1];
    const pos = coordToPos(last.coord);
    if (pos) {
      lastMove = { x: pos.x, y: pos.y, color: last.color === 'B' ? 'black' : 'white' };
    }
  }

  // 选点字母标记
  let labels: Array<{ x: number; y: number; letter: string }> | undefined;
  if (showOptions && problem.options.length > 0) {
    labels = problem.options.map(opt => {
      const pos = coordToPos(opt.coord);
      return pos ? { x: pos.x, y: pos.y, letter: opt.letter } : null;
    }).filter(Boolean) as Array<{ x: number; y: number; letter: string }>;
  }

  BoardCanvasRenderer.render(canvas, stones, { lastMove, labels });
}

main();
