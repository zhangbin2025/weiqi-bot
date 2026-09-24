import { describe, it, expect } from 'vitest';
import { estimateStrength } from '../estimator';
import type { MoveReview, BadMove } from '../../review/types';
import type { StrengthSource } from '../types';

function m(p: Partial<MoveReview>): MoveReview {
  return {
    moveNumber: 1,
    x: 0,
    y: 0,
    color: 'black',
    winRate: 0.55,
    scoreLead: 2,
    winRateChange: 0,
    isBadMove: false,
    candidates: [{ x: 0, y: 0, winRate: 0.6, scoreLead: 3, visits: 200 }],
    ...p,
  };
}

describe('estimateStrength (live)', () => {
  it('强黑棋：高命中、无失误 → 高段位', () => {
    const moves: MoveReview[] = [];
    for (let i = 0; i < 100; i++) {
      // 黑方全部命中 AI 首选
      moves.push(m({ moveNumber: i * 2 + 1, color: 'black', winRate: 0.62, scoreLead: 6, isBadMove: false }));
      // 白方落点偏离候选（命中率 0），且有失误
      moves.push(
        m({
          moveNumber: i * 2 + 2,
          color: 'white',
          winRate: 0.38,
          scoreLead: -6,
          isBadMove: true,
          severity: 'moderate',
          candidates: [{ x: 9, y: 9, winRate: 0.55, scoreLead: 4, visits: 200 }],
        }),
      );
    }
    const src: StrengthSource = { kind: 'live', moves };
    const rep = estimateStrength(src);
    expect(rep.source).toBe('live');
    expect(rep.black.score).toBeGreaterThan(rep.white.score);
    expect(rep.black.foxDan).toBeGreaterThanOrEqual(25);
    expect(rep.white.hasCandidateData).toBe(true);
  });

  it('空手数 → 两端归零', () => {
    const rep = estimateStrength({ kind: 'live', moves: [] });
    expect(rep.black.score).toBe(0);
    expect(rep.white.score).toBe(0);
  });
});

describe('estimateStrength (saved)', () => {
  it('从已保存数据重建，无 candidates 时降级', () => {
    const trend = Array.from({ length: 80 }, (_, i) => ({
      moveNumber: i + 1,
      winRate: i % 2 === 0 ? 0.55 : 0.45,
      scoreLead: i % 2 === 0 ? 3 : -3,
    }));
    const badMoves: BadMove[] = Array.from({ length: 10 }, (_, i) => ({
      moveNumber: i * 2 + 1,
      x: 0,
      y: 0,
      color: 'black',
      winRateLoss: 12,
      severity: 'moderate',
    }));
    const src: StrengthSource = {
      kind: 'saved',
      data: { winrateTrend: trend, badMoves, totalMoves: 80 },
      blackName: '张三',
      whiteName: '李四',
    };
    const rep = estimateStrength(src);
    expect(rep.source).toBe('saved');
    expect(rep.blackName).toBe('张三');
    // 有 10/40≈25% 中等失误（每手扣分 ~11），分数应明显低于无失误基线
    expect(rep.black.score).toBeLessThan(95);
    expect(rep.black.score).toBeGreaterThan(60);
    expect(rep.black.hasCandidateData).toBe(false);
  });

  it('保存态含 candidates 时命中率可用', () => {
    const trend = Array.from({ length: 60 }, (_, i) => ({
      moveNumber: i + 1,
      winRate: i % 2 === 0 ? 0.6 : 0.4,
      scoreLead: 0,
    }));
    const moveCandidates = Array.from({ length: 60 }, (_, i) => [
      { x: 0, y: 0, wr: 0.6, sl: 2, v: 100 },
      { x: 1, y: 1, wr: 0.5, sl: 1, v: 80 },
    ]);
    const src: StrengthSource = {
      kind: 'saved',
      data: { winrateTrend: trend, moveCandidates, totalMoves: 60 },
    };
    const rep = estimateStrength(src);
    expect(rep.black.hasCandidateData).toBe(true);
  });
});
