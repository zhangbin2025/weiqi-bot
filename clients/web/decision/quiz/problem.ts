/**
 * 题目加载与渲染
 * @description 加载题目、更新界面、渲染题目局面
 */

import { state, resetAnswerState } from './state';
import { rebuildBoard, syncBoard, markOptions, clearMarkers, clearHighlights, highlightLastMove } from './board';
import { currentProblem } from './state';
import { setText, getPhaseText, getLevelText } from './utils';

/**
 * 加载题目
 */
export function loadProblem(index: number): void {
  if (index < 0 || index >= state.problems.length) return;
  
  state.currentIndex = index;
  resetAnswerState();
  
  const problem = currentProblem();
  
  // 更新界面
  updateHeader(problem);
  renderProblemPosition(problem);
  updateSlider(problem);
  updateProgressText();
  updateNavButtons();
  
  // 隐藏结果卡片
  const resultCard = document.getElementById('resultCard');
  resultCard?.classList.add('hidden');
}

/**
 * 更新头部信息
 */
function updateHeader(problem: any): void {
  const meta = problem.metadata || {};
  // 主标题保持“实战选点”，不再覆盖
  // setText('gameTitle', meta.gameName || meta.event || '实战选点');
  
  // 对局名称显示在控制栏下方
  const gameNameText = document.getElementById('gameNameText');
  const gameNameBar = document.getElementById('gameNameBar');
  const gameName = meta.gameName || meta.event || '';
  if (gameNameText && gameNameBar) {
    if (gameName) {
      gameNameText.textContent = gameName;
      gameNameBar.style.display = 'block';
    } else {
      gameNameBar.style.display = 'none';
    }
  }
  
  const blackName = meta.playerBlack || '黑棋';
  const whiteName = meta.playerWhite || '白棋';
  const blackRank = meta.blackRank ? ` (${meta.blackRank})` : '';
  const whiteRank = meta.whiteRank ? ` (${meta.whiteRank})` : '';
  
  setText('blackName', `${blackName}${blackRank}`);
  setText('whiteName', `${whiteName}${whiteRank}`);
  setText('phaseLabel', getPhaseText(problem.phase));
  setText('levelLabel', getLevelText(meta.gameLevel || 'normal'));
  
  // 更新标签样式
  const phaseTag = document.getElementById('phaseTag');
  const levelTag = document.getElementById('levelTag');
  if (phaseTag) {
    phaseTag.className = `tag tag-phase-${problem.phase}`;
    phaseTag.textContent = getPhaseText(problem.phase);
  }
  if (levelTag) {
    const levelTextValue = getLevelText(meta.gameLevel || 'normal');
    levelTag.setAttribute('data-level', levelTextValue);
    levelTag.textContent = levelTextValue;
  }
  
  // 更新轮到谁下
  const turnDot = document.getElementById('turnDot');
  const turnText = document.getElementById('turnText');
  if (turnDot && turnText) {
    if (problem.turn === 'B') {
      turnDot.className = 'turn-dot black';
      turnText.textContent = '黑下';
    } else {
      turnDot.className = 'turn-dot white';
      turnText.textContent = '白下';
    }
  }
}

/**
 * 渲染题目局面
 */
function renderProblemPosition(problem: any): void {
  // 重建棋盘到题目局面
  rebuildBoard(problem.position);
  syncBoard();
  
  // 清除标记和高亮
  clearMarkers();
  clearHighlights();
  
  // 标记选项位置
  markOptions();
  
  // 高亮最后一手棋（描点）
  highlightLastMove();
  
  // 更新当前手数
  state.currentMove = problem.position.length;
}

/**
 * 更新滑块
 */
function updateSlider(problem: any): void {
  const slider = document.getElementById('moveSlider') as HTMLInputElement | null;
  if (slider) {
    slider.max = String(problem.position.length);
    slider.value = String(problem.position.length);
    state.currentMove = problem.position.length;
  }
}

/**
 * 更新进度文本
 */
function updateProgressText(): void {
  setText('progressText', `${state.currentIndex + 1} / ${state.problems.length}`);
  setText('problemNum', `${state.currentIndex + 1}`);
}

/**
 * 更新导航按钮
 */
function updateNavButtons(): void {
  const prev = document.getElementById('prevProblemBtn') as HTMLButtonElement | null;
  const next = document.getElementById('nextProblemBtn') as HTMLButtonElement | null;
  if (prev) prev.disabled = state.currentIndex === 0;
  if (next) next.disabled = state.currentIndex >= state.problems.length - 1;
}
