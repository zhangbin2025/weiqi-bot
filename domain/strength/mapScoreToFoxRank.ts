/**
 * @fileoverview 分数 → 野狐段位映射
 *
 * 标定表集中在此，便于后续调参（不改逻辑）。
 * dan 口径对齐野狐：>=20 为业 N 段（N = dan - 20），见 services formatDan。
 */

import type { StrengthSignals } from './types';

/**
 * 分数→野狐 dan 值的锚点表（分数升序）。
 * dan 越大越强：20=1段，21=2段 ... 29=9段；<20 为级位（10=1级）。
 */
export const SCORE_TO_DAN_ANCHORS: Array<[number, number]> = [
  [0, 12],
  [20, 15],
  [35, 20],
  [50, 23],
  [65, 25],
  [80, 27],
  [90, 28],
  [100, 29],
];

/** 依锚点做分段线性插值，返回四舍五入后的 dan */
export function scoreToFoxDan(score: number): number {
  const s = Math.max(0, Math.min(100, score));
  const a = SCORE_TO_DAN_ANCHORS;
  for (let i = 0; i < a.length - 1; i++) {
    const lo = a[i]!;
    const hi = a[i + 1]!;
    if (s >= lo[0] && s <= hi[0]) {
      const t = hi[0] === lo[0] ? 0 : (s - lo[0]) / (hi[0] - lo[0]);
      return Math.round(lo[1] + (hi[1] - lo[1]) * t);
    }
  }
  return a[a.length - 1]![1];
}

/** dan → 野狐展示文案（与 services/foxwq/parsers formatDan 口径一致） */
export function foxDanToLabel(dan: number): string {
  if (dan >= 100) return '职业' + (dan - 100) + '段';
  if (dan >= 20) return '野狐 ' + (dan - 20) + '段';
  if (dan >= 11) return '野狐 ' + (dan - 10) + '级';
  return '野狐 ' + Math.max(1, dan) + '级';
}

/** 依样本量判定可信度 */
export function judgeConfidence(signals: StrengthSignals): 'high' | 'medium' | 'low' {
  const s = signals.samples;
  const c = signals.candidateSamples;
  if (s >= 80 && c >= 40) return 'high';
  if (s >= 40 && c >= 15) return 'medium';
  if (s >= 60 && c === 0) return 'medium';
  return 'low';
}
