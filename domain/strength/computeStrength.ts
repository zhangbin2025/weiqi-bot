/**
 * @fileoverview 棋力信号计算（纯函数）
 *
 * 输入某棋手所下的每一手 PlayerMoveInput，产出 StrengthSignals。
 * 不依赖 AI、不依赖存储。
 */

import type {
  PlayerMoveInput,
  StrengthSignals,
} from './types';

/**
 * 判断玩家落点在候选列表中的排名（1 起）；未命中返回 0。
 * 候选按胜率降序，index+1 即排名。
 */
function rankOf(move: PlayerMoveInput): number {
  const cands = move.candidates;
  if (!cands || cands.length === 0) return 0;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i]!;
    if (c.x === move.x && c.y === move.y) return i + 1;
  }
  return 0;
}

/**
 * 计算胜率序列波动率（0-1 归一）。
 * 采用相邻手胜率绝对变化的平均值，再按经验上界归一。
 * 纯表现波动，不区分涨跌（棋手自己落子后胜率起伏大=不稳定）。
 */
function calcVolatility(moves: PlayerMoveInput[]): number {
  if (moves.length < 2) return 0;
  const rates = moves.map((m) => clamp01(m.winRate));
  let sum = 0;
  for (let i = 1; i < rates.length; i++) {
    sum += Math.abs(rates[i]! - rates[i - 1]!);
  }
  const meanAbsDelta = sum / (rates.length - 1);
  // 经验上相邻胜率平均波动 >0.2 已属极不稳定；按 0.2 归一
  return clamp01(meanAbsDelta / 0.2);
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * 计算棋力信号
 */
export function computeStrengthSignals(moves: PlayerMoveInput[]): StrengthSignals {
  const samples = moves.length;
  if (samples === 0) {
    return {
      samples: 0,
      candidateSamples: 0,
      agreeTop1: 0,
      agreeTop3: 0,
      agreeTop5: 0,
      mistakeRate: 0,
      severeRate: 0,
      moderateRate: 0,
      minorRate: 0,
      volatility: 0,
    };
  }

  let candidateSamples = 0;
  let top1 = 0;
  let top3 = 0;
  let top5 = 0;
  let mistakes = 0;
  let severe = 0;
  let moderate = 0;
  let minor = 0;

  for (const m of moves) {
    if (m.candidates && m.candidates.length > 0) {
      candidateSamples++;
      // 命中率按包含关系累计：top1 ⊂ top3 ⊂ top5
      const rank = rankOf(m);
      if (rank >= 1) top5++;
      if (rank >= 1 && rank <= 3) top3++;
      if (rank === 1) top1++;
    }
    if (m.isBadMove) {
      mistakes++;
      if (m.severity === 'severe') severe++;
      else if (m.severity === 'moderate') moderate++;
      else minor++;
    }
  }

  const denom = candidateSamples > 0 ? candidateSamples : 1;
  const v = calcVolatility(moves);

  return {
    samples,
    candidateSamples,
    agreeTop1: top1 / denom,
    agreeTop3: top3 / denom,
    agreeTop5: top5 / denom,
    mistakeRate: mistakes / samples,
    severeRate: severe / samples,
    moderateRate: moderate / samples,
    minorRate: minor / samples,
    volatility: v,
  };
}
