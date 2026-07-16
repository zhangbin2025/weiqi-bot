/**
 * 人机对弈渲染器
 * @module presentation/pages/play/HMPlayRenderer
 */
import type { ICard, IDialog } from '../../../../core/interfaces';
import type { IAnalysisResult } from '../../../../../services/play/hm';
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
export async function renderSituation(
  _dialog: IDialog,
  result: IAnalysisResult
): Promise<void> {
  const container = document.getElementById('dialogContainer');
  if (!container) return;
  const blackWinrate = result.winRate * 100;
  const whiteWinrate = (1 - result.winRate) * 100;
  const scoreLead = result.scoreLead;
  let scoreText: string;
  let winner: string;
  if (Math.abs(scoreLead) < 0.1) {
    scoreText = '均势';
    winner = '双方';
  } else if (scoreLead > 0) {
    scoreText = `黑方领先 ${scoreLead.toFixed(1)} 目`;
    winner = '黑方';
  } else {
    scoreText = `白方领先 ${Math.abs(scoreLead).toFixed(1)} 目`;
    winner = '白方';
  }
  container.innerHTML = `
    <div class="dialog-overlay" style="display: flex;">
      <div class="dialog">
        <div class="dialog-title">📊 形势判断</div>
        <div class="situation-content">
          <div class="situation-row">
            <span class="situation-label">当前形势</span>
            <span class="situation-value">${scoreText}</span>
          </div>
          <div class="situation-row">
            <span class="situation-label">黑方胜率</span>
            <span class="situation-value">${blackWinrate.toFixed(1)}%</span>
          </div>
          <div class="situation-row">
            <span class="situation-label">白方胜率</span>
            <span class="situation-value">${whiteWinrate.toFixed(1)}%</span>
          </div>
        </div>
        <button class="dialog-btn secondary" id="closeSituationBtn" style="margin-top: 16px;">关闭</button>
      </div>
    </div>
  `;
  document.getElementById('closeSituationBtn')?.addEventListener('click', () => {
    container.innerHTML = '';
  });
}
