/**
 * 打印预览页面
 * @description 渲染题目缩略图网格，支持打印
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { BoardThumbnail } from '../../../presentation/adapters/web/components/BoardThumbnail';
import { coordToPos } from '../../../domain/sgf';
import { Game } from '../../../domain/game';
import { showError } from './problems/utils';

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
    await renderThumbnails(problems, showOptions);
    bindEvents();

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
async function renderThumbnails(problems: PrintProblem[], showOptions: boolean): Promise<void> {
  const container = document.getElementById('thumbnails');
  if (!container) return;

  const THUMBNAIL_SIZE = 600;
  const gameCountMap = new Map<string, number>();
  problems.forEach(p => {
    gameCountMap.set(p.gameId, (gameCountMap.get(p.gameId) || 0) + 1);
  });

  const gameIndexMap = new Map<string, number>();

  for (const problem of problems) {
    const card = document.createElement('div');
    card.className = 'thumbnail-card';

    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_SIZE;
    canvas.height = THUMBNAIL_SIZE;
    canvas.style.width = '300px';
      canvas.style.height = '300px';
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

    card.appendChild(canvas);
    card.appendChild(title);
    container.appendChild(card);
  }
}

/**
 * 渲染单个缩略图（支持提子）
 */
/**
 * 渲染单个缩略图（支持提子、无背景）
 */
function renderThumbnail(
  canvas: HTMLCanvasElement,
  problem: PrintProblem,
  showOptions: boolean
): void {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 使用 Game 类重建棋盘（自动处理提子）
    const game = new Game({ size: 19 });

    for (const move of problem.position) {
      const pos = coordToPos(move.coord);
      if (pos) {
        game.placeStone(pos.x, pos.y);
      }
    }

    // 获取最终棋盘状态
    const stones = game.getBoard().getAllStones();

    const size = 19;
    const padding = canvas.width * 0.05;
    const gridSize = (canvas.width - padding * 2) / (size - 1);

    // 清空画布（白色背景）
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 绘制网格线
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.0;
    for (let i = 0; i < size; i++) {
      const x = padding + i * gridSize;
      const y = padding + i * gridSize;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, canvas.width - padding);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
    }

    // 绘制星位
    ctx.fillStyle = '#000';
    const starPoints = [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];
    for (const [sx, sy] of starPoints) {
      const x = padding + sx * gridSize;
      const y = padding + sy * gridSize;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 绘制棋子
    const r = gridSize * 0.45;
    for (const stone of stones) {
      const x = padding + stone.x * gridSize;
      const y = padding + stone.y * gridSize;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);

      if (stone.color === 'black') {
        // 黑棋
        ctx.fillStyle = '#000';
        ctx.fill();
      } else {
        // 白棋
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }

    // 标记最后一手棋（中心点）
    if (problem.position.length > 0) {
      const lastMove = problem.position[problem.position.length - 1];
      const lastPos = coordToPos(lastMove.coord);
      if (lastPos) {
        const x = padding + lastPos.x * gridSize;
        const y = padding + lastPos.y * gridSize;

        ctx.fillStyle = lastMove.color === 'B' ? '#fff' : '#000';
        ctx.beginPath();
        ctx.arc(x, y, gridSize * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 渲染选点标记（只显示字母，不画圈）
    if (showOptions && problem.options.length > 0) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const opt of problem.options) {
        const pos = coordToPos(opt.coord);
        if (!pos) continue;

        const x = padding + pos.x * gridSize;
        const y = padding + pos.y * gridSize;

        // 只绘制黑色字母
        ctx.fillStyle = '#000';
        ctx.font = `bold ${gridSize * 0.85}px Arial`;
        ctx.fillText(opt.letter, x, y);
      }
    }
  } catch (error) {
    console.error('renderThumbnail 错误:', error);
    throw error;
  }
}


/**
 * 绑定事件
 */
function bindEvents(): void {
  // 打印按钮
  document.getElementById('printBtn')?.addEventListener('click', () => {
    // 检测环境类型
    const isDesktop = !!(window as any).electronAPI?.isDesktop;
    const userAgent = navigator.userAgent;
    const platform = navigator.platform;
    
    // 判断是否是Android环境
    const isAndroid = /Android/i.test(userAgent) || /Linux arm/i.test(platform);
    const isWeiqiApp = /WeiqiApp/i.test(userAgent);
    const isAndroidApp = isWeiqiApp && isAndroid && !isDesktop;
    
    if (isDesktop) {
      // Desktop环境：使用标准window.print()
      window.print();
    } else if (isAndroidApp) {
      // Android环境：调用原生打印bridge
      try {
        console.log('Calling native print bridge...');
        const result = prompt('print:invoke');
        console.log('Print bridge result:', result);
      } catch (error) {
        console.error('Print bridge failed:', error);
        alert('打印失败，请尝试截图分享');
      }
    } else {
      // Web环境：使用标准window.print()
      window.print();
    }
  });
}

main();
