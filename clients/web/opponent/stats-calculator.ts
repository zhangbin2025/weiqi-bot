/**
 * 统计计算模块
 */

import type { OpponentAnalysisResultWithBookmark } from '../../application/opponent';

/**
 * 棋谱统计结果
 */
export interface GameStats {
  opponentsCount: number;
  topOpponent: string;
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * 定式统计结果
 */
export interface JosekiStats {
  total: number;
  hot: number;
  hit: number;
  complex: number;
}

/**
 * 计算棋谱统计
 */
export function calculateGameStats(games: any[], foxwqId: string): GameStats {
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  const opponents = new Set<string>();
  const opponentCounts: Record<string, number> = {};

  games.forEach(game => {
    if (game.date) {
      if (!firstDate || firstDate > game.date) firstDate = game.date;
      if (!lastDate || lastDate < game.date) lastDate = game.date;
    }

    // 从黑白双方推断对手
    const isBlack = game.black.includes(foxwqId);
    const opponent = isBlack ? game.white : game.black;
    if (opponent && opponent !== foxwqId) {
      opponents.add(opponent);
      opponentCounts[opponent] = (opponentCounts[opponent] || 0) + 1;
    }
  });

  // 找最活跃对手
  let topOpponent = '-';
  let maxCount = 0;
  for (const [opponent, count] of Object.entries(opponentCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topOpponent = opponent;
    }
  }

  return {
    opponentsCount: opponents.size,
    topOpponent,
    firstDate,
    lastDate,
  };
}

/**
 * 计算定式统计
 */
export function calculateJosekiStats(data: OpponentAnalysisResultWithBookmark): JosekiStats {
  let josekiCount = 0;
  let hotCount = 0;
  let hitCount = 0;
  let complexCount = 0;

  if (data.joseki?.patterns) {
    josekiCount = data.joseki.count || data.joseki.patterns.length;

    data.joseki.patterns.forEach(p => {
      const prefixLen = p.prefixLen ?? p.prefix.split(/\s+/).length;
      const frequency = p.frequency ?? 0;
      const totalMoves = p.totalMoves ?? 0;

      // 热门: prefixLen >= 8 && frequency >= 5
      if (prefixLen >= 8 && frequency >= 5) hotCount++;
      // 命中: prefixLen >= 8 && prefixLen >= totalMoves
      if (prefixLen >= 8 && prefixLen >= totalMoves) hitCount++;
      // 复杂: prefixLen >= 12
      if (prefixLen >= 12) complexCount++;
    });
  }

  return {
    total: josekiCount,
    hot: hotCount,
    hit: hitCount,
    complex: complexCount,
  };
}
