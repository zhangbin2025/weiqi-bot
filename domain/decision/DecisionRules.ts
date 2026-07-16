/**
 * 决策模块 - 领域规则
 * 
 * 纯函数实现，零外部依赖
 */

import type { DecisionDifficulty, DecisionPhase, GameLevel, BadMoveSeverity } from './types';

/** 恶手判定阈值（百分比） */
const BLUNDER_THRESHOLDS = {
  minor: 10,      // 轻微失误：10-15%
  moderate: 15,   // 中等恶手：15-20%
  severe: 20,     // 严重恶手：>20%
} as const;

/**
 * 判定是否恶手（二元判断）
 * @param actualWinrate 实战胜率（0-100百分比）
 * @param bestWinrate AI推荐最佳胜率（0-100百分比）
 * @returns 是否为恶手
 */
export function isBlunder(actualWinrate: number, bestWinrate: number): boolean {
  return bestWinrate - actualWinrate > BLUNDER_THRESHOLDS.minor;
}

/**
 * 分类恶手严重程度
 * @param winRateLoss 胜率损失（百分比，正数）
 * @returns 严重程度，如果不是恶手返回 null
 */
export function classifyBadMove(winRateLoss: number): BadMoveSeverity | null {
  if (winRateLoss >= BLUNDER_THRESHOLDS.severe) return 'severe';
  if (winRateLoss >= BLUNDER_THRESHOLDS.moderate) return 'moderate';
  if (winRateLoss >= BLUNDER_THRESHOLDS.minor) return 'minor';
  return null;
}

/**
 * 计算难度
 * @param bestWinrate 最优选点胜率
 * @param secondWinrate 次优选点胜率
 * @returns 难度等级
 */
export function calcDifficulty(bestWinrate: number, secondWinrate: number): DecisionDifficulty {
  const diff = bestWinrate - secondWinrate;
  if (diff > 15) return 'easy';
  if (diff > 5) return 'medium';
  return 'hard';
}

/**
 * 阶段分类
 * @param moveNumber 手数
 * @returns 阶段类型
 */
export function classifyPhase(moveNumber: number): DecisionPhase {
  if (moveNumber <= 60) return 'layout';
  if (moveNumber <= 180) return 'middle';
  return 'endgame';
}

/**
 * 解析段位
 * @param rankStr 段位字符串
 * @returns 等级或null
 */
export function parseRank(rankStr: string | undefined): GameLevel | null {
  if (!rankStr) return null;
  
  const rank = rankStr.trim();
  
  // 职业棋手
  if (/职业|[九八七六五四三二初]段$|P\d+段/i.test(rank)) {
    return 'pro';
  }
  
  // 业余段位
  const match = rank.match(/(\d+)[段d]/i);
  if (match) {
    const d = parseInt(match[1]!, 10);
    if (d >= 5) return 'high';
    if (d >= 1) return 'normal';
  }
  
  // 级位归入normal
  if (/\d+[级k]/i.test(rank)) {
    return 'normal';
  }
  
  return null;
}

/**
 * 判定整局等级
 * @param blackRank 黑方段位
 * @param whiteRank 白方段位
 * @returns 整局等级
 */
export function determineGameLevel(blackRank?: string, whiteRank?: string): GameLevel {
  const b = parseRank(blackRank);
  const w = parseRank(whiteRank);
  
  const levels = [b, w].filter((l): l is GameLevel => l !== null);
  if (levels.length === 0) return 'normal';
  
  // 取较高等级
  const priority: GameLevel[] = ['pro', 'high', 'normal'];
  for (const p of priority) {
    if (levels.includes(p)) return p;
  }
  
  return 'normal';
}

/**
 * 生成题目ID
 * @param gameId 对局ID
 * @param moveNumber 手数
 * @returns 题目ID
 */
export function generateProblemId(gameId: string, moveNumber: number): string {
  return `${gameId}-m${moveNumber}`;
}
