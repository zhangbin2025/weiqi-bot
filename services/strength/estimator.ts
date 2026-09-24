/**
 * @fileoverview 棋力评估服务
 *
 * 从复盘分析数据（内存态或已保存态）中，按执棋方拆分，
 * 调用领域层纯函数估算双方野狐段位。不触发任何新的 AI 请求。
 */

import type { MoveReview } from '../review/types';
import type { PlayerColor } from '../../domain/primitives';
import {
  estimatePlayerStrength,
  type PlayerMoveInput,
  type StrengthEstimate,
} from '../../domain/strength';
import type { StrengthReport, StrengthSource } from './types';

/**
 * 将单手 MoveReview 转为领域层输入。
 * 注意：MoveReview.winRate 为黑方视角，需转为执棋方视角。
 */
function toPlayerMove(move: MoveReview): PlayerMoveInput {
  const ownWinRate =
    move.color === 'black' ? move.winRate : 1 - move.winRate;
  return {
    x: move.x,
    y: move.y,
    winRate: ownWinRate,
    scoreLead:
      move.color === 'black' ? move.scoreLead : -move.scoreLead,
    isBadMove: move.isBadMove,
    severity: move.badMoveSeverity,
    winRateChange: move.winRateChange,
    candidates: move.candidates
      ? move.candidates.map((c) => ({
          x: c.x,
          y: c.y,
          winRate: c.winRate,
          scoreLead: c.scoreLead,
          visits: c.visits,
        }))
      : undefined,
  };
}

/** 从内存完整分析估算 */
function estimateFromLive(moves: MoveReview[]): {
  black: StrengthEstimate;
  white: StrengthEstimate;
} {
  const black = moves.filter((m) => m.color === 'black').map(toPlayerMove);
  const white = moves.filter((m) => m.color === 'white').map(toPlayerMove);
  return {
    black: estimatePlayerStrength('black', black),
    white: estimatePlayerStrength('white', white),
  };
}

/**
 * 从已保存数据估算（兼容旧档：moveCandidates 可能缺失）。
 * 候选数据缺失时，命中率信号降级（见领域层 combineSignals）。
 */
function estimateFromSaved(data: NonNullable<StrengthSource['data']>): {
  black: StrengthEstimate;
  white: StrengthEstimate;
} {
  const trend = data.winrateTrend ?? [];
  const cands = data.moveCandidates ?? [];
  const moves = data.moves ?? [];
  const badMoves = data.badMoves ?? [];

  // 失误按执棋方归类，用于补 isBadMove 信号
  const badByColor: Record<PlayerColor, number> = { black: 0, white: 0 };
  const badSevere: Record<PlayerColor, number> = { black: 0, white: 0 };
  const badModerate: Record<PlayerColor, number> = { black: 0, white: 0 };
  const badMinor: Record<PlayerColor, number> = { black: 0, white: 0 };
  for (const b of badMoves) {
    const c = b.color;
    badByColor[c] += 1;
    if (b.severity === 'severe') badSevere[c] += 1;
    else if (b.severity === 'moderate') badModerate[c] += 1;
    else badMinor[c] += 1;
  }

  const buildFor = (color: PlayerColor): StrengthEstimate => {
    const myMoves = trend
      .map((t, i) => ({ t, i, m: moves[i] }))
      .filter((x) => !x.m || x.m.color === color);
    const playerMoves: PlayerMoveInput[] = myMoves.map(({ t }) => {
      const ownWinRate = color === 'black' ? t.winRate : 1 - t.winRate;
      return {
        x: -1,
        y: -1,
        winRate: ownWinRate,
        scoreLead: color === 'black' ? t.scoreLead : -t.scoreLead,
        isBadMove: false, // 占位，下面用 badMove 总数折算到失误率
      };
    });
    // saved 态无逐手 isBadMove，把失误总数均摊到前 K 手
    const k = Math.min(badByColor[color], playerMoves.length);
    for (let i = 0; i < k; i++) {
      playerMoves[i]!.isBadMove = true;
      playerMoves[i]!.severity =
        i < badSevere[color]
          ? 'severe'
          : i < badSevere[color] + badModerate[color]
            ? 'moderate'
            : 'minor';
    }
    // 候选命中：saved 态若含 moveCandidates，按手对齐后由领域层统计
    myMoves.forEach(({ i }, idx) => {
      const cand = cands[i];
      if (cand && cand.length > 0 && playerMoves[idx]) {
        playerMoves[idx]!.candidates = cand.map((c) => ({
          x: c.x,
          y: c.y,
          winRate: c.wr,
          scoreLead: c.sl,
          visits: c.v,
        }));
        // 命中判定需要玩家落点坐标；saved 态可能缺 moves，用 -1 表示未知（必定未命中）
      }
    });
    return estimatePlayerStrength(color, playerMoves);
  };

  return { black: buildFor('black'), white: buildFor('white') };
}

/**
 * 评估棋力（对外主入口）
 */
export function estimateStrength(source: StrengthSource): StrengthReport {
  const source2 = source.kind;
  let black: StrengthEstimate;
  let white: StrengthEstimate;

  if (source.kind === 'live' && source.moves && source.moves.length > 0) {
    const r = estimateFromLive(source.moves);
    black = r.black;
    white = r.white;
  } else if (source.data) {
    const r = estimateFromSaved(source.data);
    black = r.black;
    white = r.white;
  } else {
    // 兜底：空数据
    black = estimatePlayerStrength('black', []);
    white = estimatePlayerStrength('white', []);
  }

  return {
    black,
    white,
    source: source2,
    blackName: source.blackName,
    whiteName: source.whiteName,
  };
}
