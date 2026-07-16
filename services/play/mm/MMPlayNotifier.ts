/**
 * @fileoverview AI 自对弈回调通知器
 * @description 封装回调通知逻辑
 */

import type { BoardState } from '../../../domain/board';
import type { PlayerColor } from './types';
import type { IMMPlayCallbacks } from './IMMPlayService';

/**
 * 回调通知器
 * @description 统一管理所有回调通知
 */
export class MMPlayNotifier {
  constructor(private callbacks: IMMPlayCallbacks) {}

  /**
   * 更新回调
   */
  setCallbacks(callbacks: IMMPlayCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * 通知棋盘变化
   */
  notifyBoardChange(board: BoardState): void {
    this.callbacks.onBoardChange?.(board);
  }

  /**
   * 通知玩家切换
   */
  notifyPlayerChange(player: PlayerColor): void {
    this.callbacks.onPlayerChange?.(player);
  }

  /**
   * 通知落子
   */
  notifyMove(x: number, y: number, color: PlayerColor, moveNum: number, captured?: Array<{x: number; y: number}>): void {
    this.callbacks.onMove?.(x, y, color, moveNum, captured);
  }

  /**
   * 通知对局结束
   */
  notifyGameEnd(blackScore: number, whiteScore: number, winner: PlayerColor): void {
    this.callbacks.onGameEnd?.(blackScore, whiteScore, winner);
  }

  /**
   * 通知状态变化
   */
  notifyStatusChange(running: boolean, paused: boolean): void {
    this.callbacks.onStatusChange?.(running, paused);
  }

  /**
   * 通知错误
   */
  notifyError(error: Error): void {
    this.callbacks.onError?.(error);
  }
}
