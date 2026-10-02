/**
 * 人机对弈渲染器
 * @module presentation/pages/play/HMPlayRenderer
 */
import type { ICard } from '../../../../core/interfaces';
export interface PlayState {
  playerColor: 'black' | 'white';
  moveCount: number;
}
/**
 * 渲染玩家信息
 */
export function renderPlayState(
  _card: ICard,
  playerColor: 'black' | 'white',
  moveCount: number
): void {
  const blackNameEl = document.getElementById('blackName');
  const whiteNameEl = document.getElementById('whiteName');
  const statusEl = document.getElementById('gameStatus');
  // 更新玩家名称
  if (playerColor === 'black') {
    if (blackNameEl) blackNameEl.textContent = '玩家';
    if (whiteNameEl) whiteNameEl.textContent = 'AI';
  } else {
    if (blackNameEl) blackNameEl.textContent = 'AI';
    if (whiteNameEl) whiteNameEl.textContent = '玩家';
  }
  // 更新状态栏
  const turn = moveCount % 2 === 0 ? '黑' : '白';
  if (statusEl) {
    statusEl.textContent = `当前: ${turn}方落子`;
  }
}
