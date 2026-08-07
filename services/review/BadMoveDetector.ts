/**
 * @fileoverview 恶手检测器
 * @description 从复盘结果中提取恶手，按严重程度分级
 */

import type { PlayerColor } from '../../domain';
import { classifyBadMove, isBlunder } from '../../domain/decision';
import type { BadMove, FullReviewResult, MoveReview } from './types';

/**
 * 恶手检测器
 *
 * 从 FullReviewResult 中提取恶手，按严重程度分级：
 * - 🔴 严重恶手 - 胜率损失 > 15%
 * - 🟠 中等恶手 - 胜率损失 10-15%
 * - 🟡 轻微失误 - 胜率损失 5-10%
 */
export class BadMoveDetector {
  /**
   * 从复盘结果中提取恶手
   * @param result - 完整复盘结果
   * @returns 恶手列表
   */
  detect(result: FullReviewResult): BadMove[] {
    const badMoves: BadMove[] = [];

    for (const move of result.moves) {
      // winRateChange 是比例（-0.1 ~ -0.2），转为百分比
      const winRateLoss = Math.abs(move.winRateChange) * 100;
      const severity = classifyBadMove(winRateLoss);
      if (!severity) continue;

      badMoves.push(this.createBadMove(move, severity));
    }

    return badMoves;
  }

  /**
   * 判断单手棋是否为恶手
   * @param winRateChange - 胜率变化（比例，如 -0.1）
   * @returns 是否为恶手
   */
  isBadMove(winRateChange: number): boolean {
    const loss = Math.abs(winRateChange) * 100;
    return classifyBadMove(loss) !== null;
  }

  /**
   * 创建恶手对象
   */
  private createBadMove(move: MoveReview, severity: 'minor' | 'moderate' | 'severe'): BadMove {
    const result: BadMove = {
      moveNumber: move.moveNumber,
      x: move.x,
      y: move.y,
      color: move.color,
      winRateLoss: Math.abs(move.winRateChange) * 100,
      severity,
    };
    if (move.betterMove) {
      result.betterMove = move.betterMove;
    }
    return result;
  }
}
