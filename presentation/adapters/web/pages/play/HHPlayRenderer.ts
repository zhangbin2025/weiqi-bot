/**
 * 真人对弈渲染器
 * @module presentation/pages/play/HHPlayRenderer
 */
import type { PlayerColor } from '../../../../core/types';
/** 渲染状态 */
export interface HHRenderState {
  /** 黑方名称 */
  blackName: string;
  /** 白方名称 */
  whiteName: string;
  /** 黑方时间（秒） */
  blackTime: number;
  /** 白方时间（秒） */
  whiteTime: number;
  /** 当前玩家 */
  currentPlayer: PlayerColor;
  /** 手数 */
  moveCount: number;
  /** 状态消息 */
  statusMessage: string;
  /** 是否在游戏中 */
  inGame: boolean;
}
/**
 * 格式化时间
 */
function formatTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
/**
 * 渲染玩家信息
 */
export function renderPlayers(state: HHRenderState): void {
  const blackNameEl = document.getElementById('blackName');
  const whiteNameEl = document.getElementById('whiteName');
  const blackTimeEl = document.getElementById('blackTime');
  const whiteTimeEl = document.getElementById('whiteTime');
  const blackBox = document.getElementById('blackBox');
  const whiteBox = document.getElementById('whiteBox');
  if (blackNameEl) blackNameEl.textContent = state.blackName || '黑方';
  if (whiteNameEl) whiteNameEl.textContent = state.whiteName || '白方';
  if (blackTimeEl) {
    blackTimeEl.textContent = formatTime(state.blackTime);
    blackTimeEl.className = 'player-time' + 
      (state.currentPlayer === 'black' ? ' active' : '') +
      (state.blackTime < 60 ? ' low' : '');
  }
  if (whiteTimeEl) {
    whiteTimeEl.textContent = formatTime(state.whiteTime);
    whiteTimeEl.className = 'player-time' + 
      (state.currentPlayer === 'white' ? ' active' : '') +
      (state.whiteTime < 60 ? ' low' : '');
  }
  // 高亮当前玩家
  if (blackBox) blackBox.classList.toggle('active', state.currentPlayer === 'black');
  if (whiteBox) whiteBox.classList.toggle('active', state.currentPlayer === 'white');
}
/**
 * 渲染状态栏
 */
export function renderStatus(message: string): void {
  const statusEl = document.getElementById('gameStatus');
  if (statusEl) statusEl.textContent = message;
}
/**
 * 渲染完整状态
 */
export function renderHHState(state: HHRenderState): void {
  renderPlayers(state);
  renderStatus(state.statusMessage);
}
/**
 * 更新按钮状态
 */
export function updateButtons(inGame: boolean, isMyTurn: boolean, canUndo: boolean): void {
  const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
  const passBtn = document.getElementById('passBtn') as HTMLButtonElement;
  const countBtn = document.getElementById('countBtn') as HTMLButtonElement;
  const resignBtn = document.getElementById('resignBtn') as HTMLButtonElement;
  // 悔棋：只有在游戏中、轮到本方、有历史记录时才启用
  if (undoBtn) undoBtn.disabled = !inGame || !isMyTurn || !canUndo;
  // 停一手：只有在游戏中、轮到本方时才启用
  if (passBtn) passBtn.disabled = !inGame || !isMyTurn;
  // 数子：只有在游戏中时才启用
  if (countBtn) countBtn.disabled = !inGame;
  // 认输：只有在游戏中时才启用
  if (resignBtn) resignBtn.disabled = !inGame;
}