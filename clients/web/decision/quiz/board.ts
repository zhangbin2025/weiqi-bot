/**
 * 棋盘操作
 * @description 棋盘重建、同步、标记等操作
 */

import { coordToPos } from '../../../../domain/sgf';
import { WebBoard } from '../../../../presentation/adapters/web/components/Board';
import { Game } from '../../../../domain/game';
import { state, currentProblem } from './state';
import { QuizProblem, Move } from './types';

/**
 * 初始化棋盘
 */
export function initBoard(): void {
  const boardRoot = document.getElementById('board-root');
  if (!boardRoot) throw new Error('board-root not found');
  boardRoot.innerHTML = '';
  state.board = new WebBoard(boardRoot);
  state.board.initialize({ 
    size: 19, 
    showCoordinates: false, 
    showMoveNumbers: true, 
    theme: 'classic' 
  });
  state.game = new Game({ size: 19 });
}

/**
 * 重建棋盘到指定局面
 */
export function rebuildBoard(position: Move[]): void {
  if (!state.board || !state.game) return;
  
  // 重置棋盘
  state.game = new Game({ size: 19 });
  
  // 按顺序落子
  for (const move of position) {
    const pos = coordToPos(move.coord);
    if (pos) {
      state.game.placeStone(pos.x, pos.y);
    }
  }
}

/**
 * 同步棋盘显示
 */
export function syncBoard(): void {
  if (!state.board || !state.game) return;
  
  const stones = state.game.getBoard().getAllStones().map(s => ({
    pos: { x: s.x, y: s.y },
    color: s.color,
  }));
  state.board.clear();
  state.board.setStones(stones);
}

/**
 * 标记选项位置（透明背景，只显示字母）
 */
export function markOptions(): void {
  if (!state.board) return;
  
  const problem = currentProblem();
  state.board.clearMarkers();
  
  for (const option of problem.options) {
    const pos = coordToPos(option.coord);
    if (pos) {
      // 透明背景，只显示字母
      state.board.setMarker(pos, option.letter, true);
    }
  }
}

/**
 * 高亮最后一手棋（描点）
 */
export function highlightLastMove(): void {
  if (!state.board) return;
  
  const problem = currentProblem();
  if (problem.position.length === 0) return;
  
  const lastMove = problem.position[problem.position.length - 1];
  if (!lastMove) return;
  
  const pos = coordToPos(lastMove.coord);
  if (pos) {
    state.board.highlight(pos, 'last');
  }
}

/**
 * 清除所有标记
 */
export function clearMarkers(): void {
  if (!state.board) return;
  state.board.clearMarkers();
}

/**
 * 清除所有高亮
 */
export function clearHighlights(): void {
  if (!state.board) return;
  state.board.clearHighlights();
}

/**
 * 设置手数标记
 */
export function setMoveNumber(pos: { x: number; y: number }, number: number): void {
  if (!state.board) return;
  state.board.setMoveNumber(pos, number);
}

/**
 * 获取棋盘实例
 */
export function getBoard(): WebBoard | null {
  return state.board;
}

/**
 * 获取游戏实例
 */
export function getGame(): Game | null {
  return state.game;
}
