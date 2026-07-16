/**
 * 人机对弈页面辅助方法
 * @module presentation/pages/play/HMPlayPageHelpers
 */
import { getWebRoot } from '../../../../../infrastructure/utils/web/pathUtils';
import type { PlayerColor } from '../../../../core/types';
/**
 * 更新玩家栏显示
 */
export function updatePlayerIndicator(currentPlayer: PlayerColor, playerColor: PlayerColor): void {
  const blackBox = document.getElementById('blackBox');
  const whiteBox = document.getElementById('whiteBox');
  if (blackBox && whiteBox) {
    blackBox.classList.toggle('active', currentPlayer === 'black');
    whiteBox.classList.toggle('active', currentPlayer === 'white');
  }
}
/**
 * 更新状态栏
 */
export function updateStatus(message: string): void {
  const statusEl = document.getElementById('gameStatus');
  if (statusEl) statusEl.textContent = message;
}
/**
 * 更新手数和提子统计
 */
export function updateStats(moveCount: number, blackCaptures: number, whiteCaptures: number): void {
  const moveCountEl = document.getElementById('moveCount');
  const blackCapturesEl = document.getElementById('blackCaptures');
  const whiteCapturesEl = document.getElementById('whiteCaptures');
  if (moveCountEl) moveCountEl.textContent = String(moveCount);
  if (blackCapturesEl) blackCapturesEl.textContent = String(blackCaptures);
  if (whiteCapturesEl) whiteCapturesEl.textContent = String(whiteCaptures);
}
/**
 * 更新按钮状态
 */
export function updateButtons(isPlayerTurn: boolean, isEnded: boolean, canUndo: boolean): void {
  const situationBtn = document.getElementById('situationBtn') as HTMLButtonElement;
  if (situationBtn) situationBtn.disabled = isEnded;
  // 注意：悔棋、停一手、认输按钮已经移到菜单中，由 hm.ts 的 onUpdateButtons 回调更新
}
/**
 * 显示对局结束对话框
 */
export function showGameEndDialog(winner: PlayerColor, playerColor: PlayerColor): void {
  const container = document.getElementById('dialogContainer');
  if (!container) return;
  const isWin = winner === playerColor;
  const resultText = isWin ? '🎉 你赢了！' : '😔 AI 获胜';
  container.innerHTML = `
    <div class="dialog-overlay" style="display: flex;">
      <div class="dialog game-end-dialog">
        <div class="dialog-title">🏁 对局结束</div>
        <div class="game-result">
          <div class="result-winner">${resultText}</div>
        </div>
        <div class="dialog-btn-group">
          <button class="dialog-btn secondary" id="backHomeBtn">返回首页</button>
          <button class="dialog-btn primary" id="newGameBtn">再来一局</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('newGameBtn')?.addEventListener('click', () => {
    container.innerHTML = '';
    window.location.reload();
  });
  document.getElementById('backHomeBtn')?.addEventListener('click', () => {
    window.location.href = getWebRoot() + 'index.html';
  });
}
