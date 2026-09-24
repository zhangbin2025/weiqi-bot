/**
 * 棋力评估领域层
 * 纯函数、零外部依赖（不依赖 AI、不依赖存储）。
 */

export type {
  PlayerMoveInput,
  MoveSeverity,
  HitRank,
  StrengthSignals,
  StrengthEstimate,
} from './types';

export { computeStrengthSignals } from './computeStrength';
export {
  SCORE_TO_DAN_ANCHORS,
  scoreToFoxDan,
  foxDanToLabel,
  judgeConfidence,
} from './mapScoreToFoxRank';
export { STRENGTH_WEIGHTS, combineSignals, estimatePlayerStrength } from './strength';
