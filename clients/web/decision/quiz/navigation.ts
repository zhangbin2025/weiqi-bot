/**
 * 手数导航控制
 * @description 主状态下的手数导航和滑块控制
 */

import { coordToPos } from '../../../../domain/sgf';
import { state, currentProblem, isMainState, playSound } from './state';
import { rebuildBoard, syncBoard, clearMarkers, clearHighlights, markOptions, highlightLastMove, getGame } from './board';

/**
 * 跳转到指定手数
 */
export function goToMove(moveNumber: number): void {
  if (!isMainState()) return;
  
  const problem = currentProblem();
  if (moveNumber < 0 || moveNumber > problem.position.length) return;
  
  state.currentMove = moveNumber;
  
  // 重建棋盘到指定手数
  rebuildBoard(problem.position.slice(0, moveNumber));
  syncBoard();
  
  // 更新滑块
  const slider = document.getElementById('moveSlider') as HTMLInputElement | null;
  if (slider) {
    slider.value = String(moveNumber);
  }
  
  // 清除标记和高亮
  clearMarkers();
  clearHighlights();
  
  // 如果在题目局面最后一步，标记选项和高亮最后一手
  if (moveNumber === problem.position.length) {
    markOptions();
    highlightLastMove();
  }
}

/**
 * 主状态上一步
 */
export function mainPrev(): void {
  if (!isMainState()) return;
  if (state.currentMove <= 0) return;
  
  goToMove(state.currentMove - 1);
  playSound('capture'); // 上一步播放提子音效
}

/**
 * 主状态下一步
 */
export function mainNext(): void {
  if (!isMainState()) return;
  
  const problem = currentProblem();
  if (state.currentMove >= problem.position.length) return;
  
  goToMove(state.currentMove + 1);
  playSound('stone');
}

/**
 * 同步导航按钮状态
 */
export function syncNavigationButtons(): void {
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  
  const problem = currentProblem();
  
  if (prevBtn) {
    prevBtn.classList.toggle('disabled', state.currentMove <= 0);
  }
  
  if (nextBtn) {
    nextBtn.classList.toggle('disabled', state.currentMove >= problem.position.length);
  }
}
