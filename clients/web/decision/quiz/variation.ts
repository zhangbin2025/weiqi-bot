/**
 * 变化图模式
 * @description 变化图浏览和导航
 */

import { coordToPos } from '../../../../domain/sgf';
import { state, currentProblem, isVariationState, setState, playSound } from './state';
import { rebuildBoard, syncBoard, clearMarkers, clearHighlights, setMoveNumber, getGame } from './board';
import { goToMove } from './navigation';
import { QuizOption } from './types';
import { STATE_MAIN, STATE_VARIATION, Move } from './types';

/**
 * 开始变化图模式 - 只下第一着
 */
export function startVariation(optionIndex: number): void {
  const problem = currentProblem();
  const option = problem.options[optionIndex];
  if (!option) return;

  setState(STATE_VARIATION);
  state.currentVariation = option.variation || [];
  state.variationIndex = 0;

  // 显示返回按钮，隐藏上一步/下一步
  const backBtn = document.getElementById('backToParentBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (backBtn) backBtn.style.display = 'flex';
  if (prevBtn) prevBtn.style.display = 'flex';
  if (nextBtn) nextBtn.style.display = 'flex';

  // 添加变化图模式样式
  document.querySelector('.container')?.classList.add('variation-mode');

  // 隐藏结果卡片
  document.getElementById('resultCard')?.classList.add('hidden');

  // 重建棋盘到题目位置
  rebuildBoard(problem.position);
  syncBoard();

  // 清除选点标记和描点
  clearMarkers();
  clearHighlights();

  // 只下第一着（选点本身）
  if (state.currentVariation.length > 0) {
    const firstMove = state.currentVariation[0];
    if (firstMove) {
      const pos = coordToPos(firstMove.coord);
      const game = getGame();
      if (pos && game) {
        game.placeStone(pos.x, pos.y);
        syncBoard();
        setMoveNumber(pos, 1);
        playSound('stone');
      }
    }
    state.variationIndex = 1;
  }

  // 更新按钮标题
  updateVariationInfo(option, optionIndex === problem.correctIndex);
}

/**
 * 更新变化图信息到控制栏
 */
function updateVariationInfo(option: QuizOption, isCorrect: boolean): void {
  const winrate = option.winrate ? `${option.winrate.toFixed(1)}%` : '';
  const label = isCorrect ? '实战选点' : '变化图';
  const info = winrate ? `${label} · 胜率 ${winrate}` : label;

  const nextBtn = document.getElementById('nextBtn');
  const prevBtn = document.getElementById('prevBtn');
  if (nextBtn) nextBtn.title = info;
  if (prevBtn) prevBtn.title = '返回上一步';
}

/**
 * 变化图上一步
 */
export function variationPrev(): void {
  if (!isVariationState()) return;
  if (state.variationIndex <= 0) return;

  state.variationIndex--;

  const problem = currentProblem();
  rebuildBoard(problem.position);

  const game = getGame();
  for (let i = 0; i < state.variationIndex; i++) {
    const move = state.currentVariation[i];
    if (!move) continue;
    const pos = coordToPos(move.coord);
    if (pos && game) game.placeStone(pos.x, pos.y);
  }

  syncBoard();

  // 清除选点标记和描点
  clearMarkers();
  clearHighlights();

  // 标记手数
  for (let i = 0; i < state.variationIndex; i++) {
    const move = state.currentVariation[i];
    if (!move) continue;
    const pos = coordToPos(move.coord);
    if (pos) setMoveNumber(pos, i + 1);
  }
}

/**
 * 变化图下一步
 */
export function variationNext(): void {
  if (!isVariationState()) return;
  if (state.variationIndex >= state.currentVariation.length) return;

  const move = state.currentVariation[state.variationIndex];
  if (!move) return;

  const pos = coordToPos(move.coord);
  const game = getGame();
  if (pos && game) {
    game.placeStone(pos.x, pos.y);
    syncBoard();
    setMoveNumber(pos, state.variationIndex + 1);
    playSound('stone');
  }

  state.variationIndex++;
}

/**
 * 返回主状态
 */
export function backToMain(): void {
  if (!isVariationState()) return;

  setState(STATE_MAIN);
  state.currentVariation = [];
  state.variationIndex = 0;

  // 隐藏返回按钮
  const backBtn = document.getElementById('backToParentBtn');
  if (backBtn) backBtn.style.display = 'none';

  // 移除变化图模式样式
  document.querySelector('.container')?.classList.remove('variation-mode');

  // 恢复按钮标题
  const nextBtn = document.getElementById('nextBtn');
  const prevBtn = document.getElementById('prevBtn');
  if (nextBtn) nextBtn.title = '下一手';
  if (prevBtn) prevBtn.title = '上一手';

  // 显示结果卡片
  if (state.answered) {
    document.getElementById('resultCard')?.classList.remove('hidden');
  }

  // 恢复到当前手数
  goToMove(state.currentMove);
}
