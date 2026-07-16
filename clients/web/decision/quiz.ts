/**
 * 实战选点答题页入口
 * @description 点击选点答题，底部显示结果卡片
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { WebBoard } from '../../../presentation/adapters/web/components/Board';
import { WebAudioPlayer } from '../../../infrastructure/audio/WebAudioPlayer';
import { ExportService } from '../../../services/export/ExportService';
import { WebFileExporter } from '../../../infrastructure/utils/export/WebFileExporter';
import { coordToPos, posToCoord } from '../../../domain/sgf';
import { state, currentProblem } from './quiz/state';
import { initBoard, syncBoard, clearMarkers, clearHighlights, markOptions, getBoard } from './quiz/board';
import { loadProblem } from './quiz/problem';
import { selectOption } from './quiz/answer';
import { startVariation, variationPrev, variationNext, backToMain } from './quiz/variation';
import { startTrial, addTrialMove, trialPrev, trialNext, exitTrial } from './quiz/trial';
import { goToMove, mainPrev, mainNext } from './quiz/navigation';
import { normalizeProblemForPage, getGroupProblems, showFatal } from './quiz/utils';
import { STATE_MAIN, STATE_TRYPLAY, STATE_VARIATION, QuizProblem, Move } from './quiz/types';

async function main() {
  const ctx = await WebBootstrap.init({ containerId: 'page-root' });
  state.audioPlayer = new WebAudioPlayer();
  
  // 创建导出服务
  const fileExporter = new WebFileExporter();
  state.exportService = new ExportService(fileExporter);

  const params = new URLSearchParams(window.location.search);
  const favoriteId = params.get('favoriteId');
  const problemIndex = parseInt(params.get('problemIndex') || '0', 10) || 0;
  const groupIndex = parseInt(params.get('groupIndex') || '-1', 10);

  if (!favoriteId) {
    showFatal('缺少题目ID');
    return;
  }

  try {
    const fav = await ctx.favoriteService?.getById(favoriteId);
    const rawProblems = (fav?.data?.['problems'] as any[]) || [];
    if (!rawProblems.length) {
      showFatal('没有题目数据');
      return;
    }

    const allProblems = rawProblems.map((problem, index) => normalizeProblemForPage(problem, index));
    const groupProblems = getGroupProblems(allProblems, fav?.data as Record<string, unknown>, groupIndex);
    const normalized = groupProblems.length ? groupProblems : allProblems;
    const localStart = Math.max(0, normalized.findIndex(p => p.__originalIndex === problemIndex));
    const start = localStart >= 0 ? localStart : 0;
    state.problems = normalized.slice(start).concat(normalized.slice(0, start));

    initBoard();
    bindEvents();
    loadProblem(0);
  } catch (e) {
    console.error('加载题目失败', e instanceof Error ? e : new Error(String(e)));
    showFatal('加载题目失败');
  }
}

function bindEvents(): void {
  document.getElementById('prevProblemBtn')?.addEventListener('click', () => loadProblem(state.currentIndex - 1));
  document.getElementById('nextProblemBtn')?.addEventListener('click', () => loadProblem(state.currentIndex + 1));

  const slider = document.getElementById('moveSlider') as HTMLInputElement | null;
  if (slider) {
    slider.addEventListener('input', (e) => goToMove(parseInt((e.target as HTMLInputElement).value, 10)));
  }

  document.getElementById('prevBtn')?.addEventListener('click', handlePrevMove);
  document.getElementById('nextBtn')?.addEventListener('click', handleNextMove);
  // 音效开关和保存SGF已移到菜单，改为监听window事件
  window.addEventListener('toggleSound', ((e: CustomEvent) => {
    state.soundEnabled = e.detail;
  }) as EventListener);
  window.addEventListener('downloadSGF', saveToSGF);
  document.getElementById('backToParentBtn')?.addEventListener('click', handleBackToParent);

  getBoard()?.on({ onClick: (pos) => handleBoardClick(pos.x, pos.y) });
}

function handleBoardClick(x: number, y: number): void {
  if (state.currentState === STATE_MAIN) {
    handleMainClick(x, y);
  } else if (state.currentState === STATE_TRYPLAY) {
    addTrialMove(x, y);
  }
}

function handleMainClick(x: number, y: number): void {
  const problem = state.problems[state.currentIndex];
  if (!problem) return;

  // 检查是否点击了选项
  let clickedOptionIndex = -1;
  for (let i = 0; i < problem.options.length; i++) {
    const opt = problem.options[i];
    const pos = coordToPos(opt.coord);
    if (pos && pos.x === x && pos.y === y) {
      clickedOptionIndex = i;
      break;
    }
  }

  if (clickedOptionIndex !== -1) {
    if (!state.answered) {
      selectOption(clickedOptionIndex);
    } else {
      // 答题后点击选点查看变化图
      startVariation(clickedOptionIndex);
    }
  } else if (!state.answered && state.currentMove === problem.position.length) {
    // 未点击选点且在选点局面，进入试下
    startTrial(x, y);
  }
}

function handlePrevMove(): void {
  if (state.currentState === STATE_VARIATION) {
    variationPrev();
  } else if (state.currentState === STATE_TRYPLAY) {
    trialPrev();
  } else {
    mainPrev();
  }
}

function handleNextMove(): void {
  if (state.currentState === STATE_VARIATION) {
    variationNext();
  } else if (state.currentState === STATE_TRYPLAY) {
    trialNext();
  } else {
    mainNext();
  }
}

function handleBackToParent(): void {
  if (state.currentState === STATE_TRYPLAY) {
    exitTrial();
  } else if (state.currentState === STATE_VARIATION) {
    backToMain();
  }
}

function toggleSound(): void {
  state.soundEnabled = !state.soundEnabled;
  const btn = document.getElementById('soundToggleBtn');
  if (btn) btn.textContent = state.soundEnabled ? '🔊' : '🔇';
}

async function saveToSGF(): Promise<void> {
  const problem = currentProblem();
  if (!problem) return;
  
  // 收集所有着法
  let moves: Move[] = [];
  
  // 添加初始局面
  moves = moves.concat(problem.position);
  
  // 根据当前状态添加额外着法
  if (state.currentState === STATE_TRYPLAY) {
    // 试下模式：添加试下着法
    moves = moves.concat(state.trialMoves.slice(0, state.trialIndex + 1).map(m => ({
      color: m.color,
      coord: posToCoord(m.x, m.y)
    })));
  } else if (state.currentState === STATE_VARIATION) {
    // 变化图模式：添加变化图着法
    moves = moves.concat(state.currentVariation.slice(0, state.variationIndex + 1));
  }
  
  // 生成 SGF
  const sgf = generateSGF(moves, problem.metadata);
  
  // 触发下载
  await downloadSGF(sgf, problem.metadata.gameName || problem.metadata.event || '实战选点');
}

function generateSGF(moves: Move[], metadata: Record<string, any>): string {
  let sgf = '(;GM[1]FF[4]SZ[19]';
  
  // 添加元数据
  if (metadata.playerBlack) sgf += `PB[${metadata.playerBlack}]`;
  if (metadata.playerWhite) sgf += `PW[${metadata.playerWhite}]`;
  if (metadata.gameName) sgf += `GN[${metadata.gameName}]`;
  if (metadata.event) sgf += `EV[${metadata.event}]`;
  
  // 添加着法
  for (const move of moves) {
    const color = move.color === 'B' ? 'B' : 'W';
    sgf += `;${color}[${move.coord}]`;
  }
  
  sgf += ')';
  return sgf;
}

async function downloadSGF(sgf: string, filename: string): Promise<void> {
  if (state.exportService) {
    const result = await state.exportService.exportSGF(sgf, filename);
    if (!result.success) {
      console.error('导出失败:', result.error);
      alert(`导出失败: ${result.error}`);
    }
  } else {
    // Fallback: 直接使用 Blob 下载
    const blob = new Blob([sgf], { type: 'application/x-go-sgf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.sgf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

main().catch(console.error);
