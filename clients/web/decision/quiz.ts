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
import { normalizeProblemForPage, showFatal } from './quiz/utils';
import { normalizeGroups, GameGroup } from './problems/normalize';
import { STATE_MAIN, STATE_TRYPLAY, STATE_VARIATION, QuizProblem, Move } from './quiz/types';

type PhaseFilter = 'all' | 'layout' | 'middle' | 'endgame';

/**
 * 从 URL 读取筛选参数
 */
function getPhaseFromUrl(): PhaseFilter {
  const params = new URLSearchParams(window.location.search);
  const phase = params.get('phase') as PhaseFilter;
  return ['all', 'layout', 'middle', 'endgame'].includes(phase) ? phase : 'all';
}

/**
 * 按阶段过滤题目
 */
function filterProblemsByPhase(problems: any[], phase: PhaseFilter): any[] {
  return phase === 'all' ? problems : problems.filter(p => p.phase === phase);
}

/**
 * 根据分组获取题目
 */
function getGroupProblems(
  allProblems: QuizProblem[], 
  groups: GameGroup[], 
  groupIndex: number
): QuizProblem[] {
  if (groupIndex < 0 || groupIndex >= groups.length) return [];
  const group = groups[groupIndex];
  return group?.problemIndexes?.map(i => allProblems[i]).filter((p): p is QuizProblem => Boolean(p)) || [];
}

async function main() {
  const ctx = await WebBootstrap.init({ containerId: 'page-root' });
  state.audioPlayer = new WebAudioPlayer();
  state.exportService = new ExportService(new WebFileExporter());

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

    const phase = getPhaseFromUrl();
    const filteredRawProblems = filterProblemsByPhase(rawProblems, phase);
    
    // 归一化题目（保留原始索引用于导出）
    const allProblems = filteredRawProblems.map(problem => 
      normalizeProblemForPage(problem, rawProblems.indexOf(problem))
    );
    
    // 重新计算分组
    const filteredData = { ...fav?.data } as Record<string, unknown>;
    delete filteredData['gameGroups'];
    const groups = normalizeGroups(filteredRawProblems, filteredData);
    
    // 获取当前棋谱的题目
    const groupProblems = getGroupProblems(allProblems, groups, groupIndex);
    const normalized = groupProblems.length ? groupProblems : allProblems;
    
    // 设置题目列表
    const start = Math.min(problemIndex, normalized.length - 1);
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

  const clickedOptionIndex = problem.options.findIndex(opt => { const pos = coordToPos(opt.coord); return pos && pos.x === x && pos.y === y; });
  if (clickedOptionIndex >= 0) {
    selectOption(clickedOptionIndex);
  }
}

function handlePrevMove() {
  if (state.currentState === STATE_VARIATION) {
    variationPrev();
  } else if (state.currentState === STATE_TRYPLAY) {
    trialPrev();
  } else {
    mainPrev();
  }
}

function handleNextMove() {
  if (state.currentState === STATE_VARIATION) {
    variationNext();
  } else if (state.currentState === STATE_TRYPLAY) {
    trialNext();
  } else {
    mainNext();
  }
}

function handleBackToParent() {
  if (state.currentState === STATE_VARIATION) {
    backToMain();
  } else if (state.currentState === STATE_TRYPLAY) {
    exitTrial();
  } else {
    const favoriteId = new URLSearchParams(window.location.search).get('favoriteId') || '';
    const phase = getPhaseFromUrl();
    const phaseParam = phase !== 'all' ? `&phase=${phase}` : '';
    window.location.href = `list.html?favoriteId=${encodeURIComponent(favoriteId)}${phaseParam}`;
  }
}

async function saveToSGF() {
  const problem = state.problems[state.currentIndex];
  if (!problem) return;

  try {
    const sgf = state.exportService?.exportToSGF(problem);
    if (!sgf) return;

    const filename = `problem_${problem.__originalIndex + 1}.sgf`;
    await state.fileExporter?.save(sgf, filename);
  } catch (e) {
    console.error('导出 SGF 失败', e);
  }
}

main().catch(console.error);
