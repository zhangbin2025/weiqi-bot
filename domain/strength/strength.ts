/**
 * @fileoverview 棋力评估主逻辑（纯函数）
 *
 * 组合信号 → 综合分数 → 野狐段位估计。零外部依赖。
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
 * 评分权重（可调标定）。初版经验权重：
 * - 失误惩罚：整体失误率 + 严重失误额外惩罚
 * - 命中加成：top5 命中率越高越接近 AI 水平
 * - 稳定性：波动越低越好
 *
 * 设计目标：score 从 0(弱) 到 100(强)，约对应 野狐 1级 ~ 9段。
 */
export const STRENGTH_WEIGHTS = {
  /** 每 1% 失误率扣分 */
  mistakePenalty: 0.45,
  /** 每 1% 严重失误率额外扣分 */
  severePenalty: 0.30,
  /** 每 1% top5 命中率加分 */
  hitBonus: 0.35,
  /** 波动惩罚系数（volatility 0-1 时最大扣 10 分） */
  volatilityPenalty: 10,
};

/**
 * 信号 → 综合分数(0-100)
 */
export function combineSignals(
  signals: StrengthSignals,
  weights = STRENGTH_WEIGHTS,
): number {
  if (signals.samples === 0) return 0;

  const w = weights;
  let score = 100;

  // 失误惩罚
  score -= signals.mistakeRate * 100 * w.mistakePenalty;
  score -= signals.severeRate * 100 * w.severePenalty;

  // 命中加成：仅在候选数据可用时使用（否则不加分也不减分）
  if (signals.candidateSamples > 0) {
    score += signals.agreeTop5 * 100 * w.hitBonus;
  }

  // 稳定性
  score -= signals.volatility * w.volatilityPenalty;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * 评估单个棋手棋力
 * @param color 该棋手颜色
 * @param moves 该棋手所下的每一手
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
