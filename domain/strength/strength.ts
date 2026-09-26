/**
 * @fileoverview 棋力评估主逻辑（纯函数）
 *
 * 组合信号 → 综合分数 → 野狐段位估计。零外部依赖。
 *
 * 评分设计：
 * - 有候选数据时：命中率是主信号 + 胜率形态信号辅助
 * - 无候选数据时：胜率形态信号（平滑度/稳定性/大幅下落）为主，失误率辅助
 */

import type { PlayerColor } from '../primitives';
import type {
  PlayerMoveInput,
  StrengthSignals,
  StrengthEstimate,
} from './types';
import { computeStrengthSignals } from './computeStrength';
import {
  scoreToFoxDan,
  foxDanToLabel,
  judgeConfidence,
} from './mapScoreToFoxRank';

/**
 * 评分权重（可调标定）。
 */
export const STRENGTH_WEIGHTS = {
  // ── 无候选数据模式权重 ──
  noCandidate: {
    /** 每 1% 失误率扣分 */
    mistakePenalty: 0.20,
    /** 每 1% 严重失误率扣分 */
    severePenalty: 0.15,
    /** 波动惩罚系数（volatility 0-1 时最大扣多少分） */
    volatilityPenalty: 10,
    /** 胜率平滑度权重：(1-sm) * weight */
    smoothnessWeight: 40,
    /** 优势稳定性权重：(1-st) * weight */
    stabilityWeight: 30,
    /** 大幅下落率权重：ld * 100 * weight / 100 = ld * weight */
    largeDropWeight: 40,
  },
  // ── 有候选数据模式权重 ──
  withCandidate: {
    /** 每 1% 失误率扣分 */
    mistakePenalty: 0.12,
    /** 每 1% 严重失误率扣分 */
    severePenalty: 0.08,
    /** 每 1% top5 命中率加分 */
    hitBonus: 0.25,
    /** 波动惩罚系数 */
    volatilityPenalty: 5,
    /** 胜率平滑度权重 */
    smoothnessWeight: 25,
    /** 优势稳定性权重 */
    stabilityWeight: 15,
    /** 大幅下落率权重 */
    largeDropWeight: 25,
  },
};

/**
 * 信号 → 综合分数(0-100)
 */
export function combineSignals(signals: StrengthSignals): number {
  if (signals.samples === 0) return 0;

  const hasCandidate = signals.candidateSamples > 0;
  const w = hasCandidate ? STRENGTH_WEIGHTS.withCandidate : STRENGTH_WEIGHTS.noCandidate;

  let score = 100;

  // ── 失误惩罚 ──
  score -= signals.mistakeRate * 100 * w.mistakePenalty;
  score -= signals.severeRate * 100 * w.severePenalty;

  // ── 命中加成（仅有候选数据时） ──
  if (hasCandidate) {
    score += signals.agreeTop5 * 100 * w.hitBonus;
  }

  // ── 胜率形态信号（线性，阈值已收紧） ──
  score -= (1 - signals.smoothness) * w.smoothnessWeight;
  score -= (1 - signals.stability) * w.stabilityWeight;
  score -= signals.largeDropRate * w.largeDropWeight;

  // ── 波动率 ──
  score -= signals.volatility * w.volatilityPenalty;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * 评估单个棋手棋力
 */
export function estimatePlayerStrength(
  color: PlayerColor,
  moves: PlayerMoveInput[],
): StrengthEstimate {
  const signals = computeStrengthSignals(moves);
  const score = combineSignals(signals);
  const foxDan = scoreToFoxDan(score);
  const hasCandidateData = signals.candidateSamples > 0;

  return {
    color,
    score,
    foxDan,
    label: foxDanToLabel(foxDan),
    signals,
    confidence: judgeConfidence(signals),
    hasCandidateData,
  };
}
