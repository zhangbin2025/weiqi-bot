/**
 * AI自对弈渲染器
 * @module presentation/pages/play/MMPlayRenderer
 */
import type { ICard } from '../../../../core/interfaces';
import type { PlayerColor } from '../../../../core/types';
export interface MMPlayState {
  running: boolean;
  moveCount: number;
  modelId?: string | undefined;
}
export function renderMMState(_card: ICard, state: MMPlayState): void {
  // 更新手数显示（显示在中间）
  const moveCountDisplay = document.getElementById('moveCountDisplay');
  if (moveCountDisplay) {
    moveCountDisplay.textContent = `手数: ${state.moveCount}`;
  }
}
/**
 * 更新玩家栏高亮
 */
export function updatePlayerIndicator(currentPlayer: PlayerColor): void {
  const blackBox = document.getElementById('blackBox');
  const whiteBox = document.getElementById('whiteBox');
  if (blackBox && whiteBox) {
    blackBox.classList.toggle('active', currentPlayer === 'black');
    whiteBox.classList.toggle('active', currentPlayer === 'white');
  }
}
/**
 * 更新状态文本
 */
export function updateStatus(message: string): void {
  const statusBar = document.getElementById('statusBar');
  if (statusBar) {
    statusBar.textContent = message;
  }
}
