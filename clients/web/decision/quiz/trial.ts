/**
 * 试下模式
 * @description 自由试下和导航
 */

import { coordToPos } from '../../../../domain/sgf';
import { state, currentProblem, isTryplayState, setState, isMainState, playSound } from './state';
import { rebuildBoard, syncBoard, clearMarkers, clearHighlights, setMoveNumber, getGame, markOptions, highlightLastMove, getBoard } from './board';
import { goToMove } from './navigation';
import { STATE_MAIN, STATE_TRYPLAY } from './types';

/**
 * 开始试下
 */
export function startTrial(x: number, y: number): void {
  if (!isMainState()) return;
  
  const problem = currentProblem();
  
  // 保存试下前的状态
  state.savedMoveBeforeTrial = state.currentMove;  // 保存当前手数，而不是题目长度
  state.trialMoves = [];
  state.trialIndex = 0;
  
  setState(STATE_TRYPLAY);
  
  // 重建棋盘到题目位置并渲染
  rebuildBoard(problem.position);
  syncBoard();
  markOptions();
  highlightLastMove();
  
  // 添加试下模式样式
  document.querySelector('.container')?.classList.add('trial-mode');
  
  // 显示返回按钮
  const backBtn = document.getElementById('backToParentBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (backBtn) backBtn.style.display = 'flex';
  if (prevBtn) prevBtn.style.display = 'flex';
  if (nextBtn) nextBtn.style.display = 'flex';
  
  // 设置按钮标题
  if (backBtn) backBtn.title = '返回题目';
  if (prevBtn) prevBtn.title = '上一步';
  if (nextBtn) nextBtn.title = '下一步';
  
  // 隐藏结果卡片
  document.getElementById('resultCard')?.classList.add('hidden');
  
  // 添加第一着试下
  addTrialMove(x, y);
}

/**
 * 添加试下着法
 */
export function addTrialMove(x: number, y: number): void {
  if (!isTryplayState()) return;
  
  const problem = currentProblem();
  const turn = problem.position.length % 2 === 0 ? 'B' : 'W';
  const color = (state.trialIndex % 2 === 0 ? turn : (turn === 'B' ? 'W' : 'B')) as 'B' | 'W';
  
  // 添加到试下列表
  state.trialMoves.push({ x, y, color });
  state.trialIndex = state.trialMoves.length;
  
  // 落子
  const game = getGame();
  if (game) {
    game.placeStone(x, y);
    syncBoard();
    playSound('stone');
    
    // 高亮最后一手（描点）
    clearHighlights();
    const board = getBoard();
    if (board) {
      board.highlight({ x, y }, 'last');
    }
  }
}

/**
 * 试下上一步
 */
export function trialPrev(): void {
  if (!isTryplayState()) return;
  if (state.trialIndex <= 0) return;
  
  state.trialIndex--;
  
  // 重建棋盘到题目位置 + 试下着法
  const problem = currentProblem();
  rebuildBoard(problem.position);
  
  const game = getGame();
  for (let i = 0; i < state.trialIndex; i++) {
    const move = state.trialMoves[i];
    if (move && game) {
      game.placeStone(move.x, move.y);
    }
  }
  
  syncBoard();
  
  // 清除标记
  clearMarkers();
  
  // 高亮最后一手（描点）
  clearHighlights();
  if (state.trialIndex > 0) {
    const lastMove = state.trialMoves[state.trialIndex - 1];
    if (lastMove) {
      const board = getBoard();
      if (board) {
        board.highlight({ x: lastMove.x, y: lastMove.y }, 'last');
      }
    }
  }
}

/**
 * 试下下一步
 */
export function trialNext(): void {
  if (!isTryplayState()) return;
  if (state.trialIndex >= state.trialMoves.length) return;
  
  const move = state.trialMoves[state.trialIndex];
  if (!move) return;
  
  const game = getGame();
  if (game) {
    game.placeStone(move.x, move.y);
    syncBoard();
    playSound('stone');
    
    // 高亮最后一手（描点）
    clearHighlights();
    const board = getBoard();
    if (board) {
      board.highlight({ x: move.x, y: move.y }, 'last');
    }
  }
  
  state.trialIndex++;
}

/**
 * 退出试下
 */
export function exitTrial(): void {
  if (!isTryplayState()) return;
  
  setState(STATE_MAIN);
  state.trialMoves = [];
  state.trialIndex = 0;
  
  // 移除试下模式样式
  document.querySelector('.container')?.classList.remove('trial-mode');
  
  // 隐藏返回按钮
  const backBtn = document.getElementById('backToParentBtn');
  if (backBtn) backBtn.style.display = 'none';
  
  // 恢复按钮标题
  const nextBtn = document.getElementById('nextBtn');
  const prevBtn = document.getElementById('prevBtn');
  if (nextBtn) nextBtn.title = '下一手';
  if (prevBtn) prevBtn.title = '上一手';
  
  // 恢复到试下前的手数
  goToMove(state.savedMoveBeforeTrial);
}
