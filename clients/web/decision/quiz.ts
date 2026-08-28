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

    // 从 localStorage 读取显示选点的设置
    const savedShowOptions = localStorage.getItem('quiz-showOptions');
    state.showOptions = savedShowOptions !== 'false';

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
  
  window.addEventListener('toggleShowOptions', ((e: CustomEvent) => {
    state.showOptions = e.detail;
    // 重新标记选项
    if (!state.answered) {
      markOptions();
    }
  }) as EventListener);
  
  window.addEventListener('downloadSGF', saveToSGF);
  
  // AI分析事件
  window.addEventListener('aiAnalysis', handleAiAnalysis);
  
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

  // 如果显示选点标记，点击选点答题
  if (state.showOptions) {
    const clickedOptionIndex = problem.options.findIndex(opt => { const pos = coordToPos(opt.coord); return pos && pos.x === x && pos.y === y; });
    if (clickedOptionIndex >= 0) {
      selectOption(clickedOptionIndex);
    }
  } else {
    // 不显示选点标记的困难模式：点中正确的选点才对，否则错
    if (state.answered) return;
    
    const correctCoord = problem.options[problem.correctIndex]?.coord;
    if (!correctCoord) return;
    
    const correctPos = coordToPos(correctCoord);
    if (correctPos && correctPos.x === x && correctPos.y === y) {
      // 答对了
      selectOption(problem.correctIndex);
    } else {
      // 答错了
      state.answered = true;
      state.selectedOptionIndex = -1; // -1 表示用户自己选的点
      
      // 播放音效
      if (state.soundEnabled && state.audioPlayer) {
        state.audioPlayer.play("wrong");
      }
      
      // 显示所有正确选项，告诉用户正确答案在哪
      showHiddenOptionsWrongResult(problem);
      // 答题后显示选点标记
      markOptions();
    }
  }
}

/**
 * 显示隐藏选点模式的错误结果（显示所有正确选项）
 */
function showHiddenOptionsWrongResult(problem: QuizProblem): void {
  const resultCard = document.getElementById("resultCard");
  const resultStatus = document.getElementById("resultStatus");
  const resultIcon = document.getElementById("resultIcon");
  const resultText = document.getElementById("resultText");
  const optionsList = document.getElementById("optionsList");

  if (!resultCard || !resultStatus || !resultIcon || !resultText || !optionsList) return;

  // 设置状态
  resultStatus.className = "result-status wrong";
  resultIcon.textContent = "✗";
  resultText.textContent = "答错了";

  // 渲染选项列表：显示所有正确选项，告诉用户正确答案在哪
  optionsList.innerHTML = "";
  problem.options.forEach((option, index) => {
    const item = document.createElement("div");
    const isCorrectItem = index === problem.correctIndex;

    let itemClasses = "option-item";
    if (isCorrectItem) itemClasses += " correct";

    item.className = itemClasses;

    // 选项标签
    const letterDiv = document.createElement("div");
    letterDiv.className = "option-letter";
    letterDiv.textContent = option.letter || option.label;

    // 信息
    const infoDiv = document.createElement("div");
    infoDiv.className = "option-info";

    const labelDiv = document.createElement("div");
    labelDiv.className = "option-label";
    labelDiv.textContent = option.label;
    if (isCorrectItem) labelDiv.classList.add("correct");

    const winrateDiv = document.createElement("div");
    winrateDiv.className = "option-winrate";
    winrateDiv.textContent = option.winrate !== undefined ? `${option.winrate.toFixed(1)}%` : "-";

    infoDiv.appendChild(labelDiv);
    infoDiv.appendChild(winrateDiv);

    // 指示器
    const indicatorDiv = document.createElement("div");
    indicatorDiv.className = "option-indicator";
    if (isCorrectItem) indicatorDiv.textContent = "⭐";

    item.appendChild(letterDiv);
    item.appendChild(infoDiv);
    item.appendChild(indicatorDiv);
    
    // 添加点击事件，查看变化图
    item.addEventListener("click", () => {
      startVariation(index);
    });
    item.style.cursor = "pointer";
    
    optionsList.appendChild(item);
  });

  // 显示卡片
  resultCard.classList.remove("hidden");
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
    await state.exportService?.save(sgf, filename);
  } catch (e) {
    console.error('导出 SGF 失败', e);
  }
}

/**
 * 跳转到复盘页面进行AI分析
 */
function handleAiAnalysis() {
  const problem = state.problems[state.currentIndex];
  if (!problem) {
    console.error('没有当前题目');
    return;
  }
  
  const archiveId = problem.metadata?.archiveId;
  const moveTo = problem.metadata?.moveNumber;
  
  if (!archiveId) {
    alert('该题目没有关联棋谱');
    return;
  }
  
  // 跳转到复盘页面的分析局面模式
  const url = `../review/index.html?analyzePosition=true&archiveId=${encodeURIComponent(archiveId)}&moveTo=${moveTo}`;
  window.location.href = url;
}

main().catch(console.error);
