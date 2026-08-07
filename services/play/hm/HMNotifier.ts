/**
 * @fileoverview 人机对弈通知器
 */

import type { BoardState, PlayerColor } from '../../../domain';
import type { IHMPlayCallbacks } from './types';

/**
 * 通知器
 * 负责管理回调函数并触发各类通知
 */
export class HMNotifier {
  private callbacks: IHMPlayCallbacks = {};

  /** 设置回调函数 */
  setCallbacks(callbacks: IHMPlayCallbacks): void {
    this.callbacks = callbacks;
  }

  /** 获取当前回调 */
  getCallbacks(): IHMPlayCallbacks {
    return this.callbacks;
  }

  /** 通知棋盘变化 */
  notifyBoardChange(board: BoardState): void {
    this.callbacks.onBoardChange?.(board);
  }

  /** 通知玩家变化 */
  notifyPlayerChange(player: PlayerColor): void {
    this.callbacks.onPlayerChange?.(player);
  }

  /** 通知 AI 思考状态 */
  notifyAiThinking(thinking: boolean): void {
    this.callbacks.onAiThinking?.(thinking);
  }

  /** 通知 AI 落子 */
  notifyAiMove(x: number, y: number, winRate?: number, scoreLead?: number): void {
    this.callbacks.onAiMove?.(x, y, winRate, scoreLead);
  }

  /** 通知提子 */
  notifyCapture(count: number, color: PlayerColor): void {
    this.callbacks.onCapture?.(count, color);
  }

  /** 通知游戏结束 */
  notifyGameEnd(winner: PlayerColor, reason: string): void {
    this.callbacks.onGameEnd?.(winner, reason);
  }

  /** 通知错误 */
  notifyError(error: Error): void {
    this.callbacks.onError?.(error);
  }
}
