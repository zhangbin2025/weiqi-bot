/**
 * @fileoverview 人机对弈游戏状态管理器
 */

import type { PlayerColor } from '../../../domain';
import type { IHMPlayConfig } from './types';

/** AI 认输参数 */
const RESIGN_THRESHOLD = 0.05; // AI 胜率低于 5% 考虑认输
const RESIGN_CONSEC_TURNS = 3;  // 连续 3 手都低于阈值才认输

/**
 * 游戏状态管理器
 * 负责管理游戏配置、连续虚手计数、游戏状态查询
 */
export class HMGameStateManager {
  private config: IHMPlayConfig | null = null;
  private consecutivePasses = 0;
  private lowWinRateCount = 0; // AI 连续低胜率手数

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
    this.lowWinRateCount = 0;
  }

  /** 检查 AI 是否应该认输 */
  shouldAiResign(aiWinRate: number): boolean {
    if (aiWinRate < RESIGN_THRESHOLD) {
      this.lowWinRateCount++;
    } else {
      this.lowWinRateCount = 0;
    }
    return this.lowWinRateCount >= RESIGN_CONSEC_TURNS;
  }
}
