/**
 * @fileoverview 人机对弈游戏状态管理器
 */

import type { PlayerColor } from '../../../domain';
import type { IHMPlayConfig } from './types';

/**
 * 游戏状态管理器
 * 负责管理游戏配置、连续虚手计数、游戏状态查询
 */
export class HMGameStateManager {
  private config: IHMPlayConfig | null = null;
  private consecutivePasses = 0;

  /** 设置游戏配置 */
  setConfig(config: IHMPlayConfig): void {
    this.config = config;
  }

  /** 获取游戏配置 */
  getConfig(): IHMPlayConfig | null {
    return this.config;
  }

  /** 重置虚手计数 */
  resetPasses(): void {
    this.consecutivePasses = 0;
  }

  /** 增加虚手计数 */
  incrementPasses(): number {
    this.consecutivePasses++;
    return this.consecutivePasses;
  }

  /** 获取当前虚手计数 */
  getConsecutivePasses(): number {
    return this.consecutivePasses;
  }

  /** 判断是否玩家回合 */
  isPlayerTurn(currentPlayer: PlayerColor): boolean {
    if (!this.config) return false;
    return currentPlayer === this.config.playerColor;
  }

  /** 判断是否允许悔棋 */
  canUndo(moveHistoryLength: number): boolean {
    // 如果禁止悔棋，返回 false
    if (this.config?.noUndo) return false;
    // 否则检查是否有历史记录
    return moveHistoryLength > 0;
  }

  /** 重置状态 */
  reset(): void {
    this.config = null;
    this.consecutivePasses = 0;
  }
}
