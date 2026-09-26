import { describe, it, expect } from 'vitest';
import { computeStrengthSignals } from '../computeStrength';
import { scoreToFoxDan, foxDanToLabel, judgeConfidence } from '../mapScoreToFoxRank';
import { combineSignals, estimatePlayerStrength } from '../strength';
import type { PlayerMoveInput } from '../types';

function move(p: Partial<PlayerMoveInput>): PlayerMoveInput {
  return {
    x: 0,
    y: 0,
    winRate: 0.5,
    scoreLead: 0,
    isBadMove: false,
    ...p,
  };
}

describe('computeStrengthSignals', () => {
  it('空手数返回零信号', () => {
    const s = computeStrengthSignals([]);
    expect(s.samples).toBe(0);
    expect(s.agreeTop5).toBe(0);
    expect(s.smoothness).toBe(0);
    expect(s.stability).toBe(0);
    expect(s.largeDropRate).toBe(0);
  });

  it('命中 top1 计入 agreeTop1/3/5', () => {
    const moves = [
      move({ x: 3, y: 3, candidates: [{ x: 3, y: 3, winRate: 0.6, scoreLead: 5, visits: 100 }] }),
      move({ x: 5, y: 5, candidates: [{ x: 1, y: 1, winRate: 0.6, scoreLead: 5, visits: 100 }, { x: 5, y: 5, winRate: 0.5, scoreLead: 2, visits: 80 }] }),
    ];
    const s = computeStrengthSignals(moves);
    expect(s.candidateSamples).toBe(2);
    expect(s.agreeTop1).toBe(0.5);
    expect(s.agreeTop3).toBe(1);
    expect(s.agreeTop5).toBe(1);
  });

  it('失误分级统计正确', () => {
    const moves = [
      move({ isBadMove: true, severity: 'severe' }),
      move({ isBadMove: true, severity: 'moderate' }),
      move({ isBadMove: true, severity: 'minor' }),
      move({ isBadMove: false }),
    ];
    const s = computeStrengthSignals(moves);
    expect(s.mistakeRate).toBe(0.75);
    expect(s.severeRate).toBe(0.25);
    expect(s.moderateRate).toBe(0.25);
    expect(s.minorRate).toBe(0.25);
  });

  it('胜率平滑度：稳定胜率 → 高平滑度', () => {
    // 每手变化 0.01 < 0.05 阈值
    const moves = Array.from({ length: 10 }, (_, i) => move({ winRate: 0.5 + i * 0.01 }));
    const s = computeStrengthSignals(moves);
    expect(s.smoothness).toBe(1);
  });

  it('胜率平滑度：中等震荡 → 低平滑度', () => {
    // 每手变化 0.06 > 0.05 阈值，无 clamp
    const moves = Array.from({ length: 10 }, (_, i) => move({ winRate: 0.3 + i * 0.06 }));
    const s = computeStrengthSignals(moves);
    expect(s.smoothness).toBe(0);
  });

  it('胜率平滑度：剧烈震荡 → 低平滑度', () => {
    const moves = Array.from({ length: 10 }, (_, i) => move({ winRate: i % 2 === 0 ? 0.8 : 0.2 }));
    const s = computeStrengthSignals(moves);
    expect(s.smoothness).toBe(0);
  });

  it('优势稳定性：不切换优势 → 高稳定性', () => {
    const moves = Array.from({ length: 10 }, (_, i) => move({ winRate: 0.6 + i * 0.01 }));
    const s = computeStrengthSignals(moves);
    expect(s.stability).toBe(1);
  });

  it('优势稳定性：频繁切换 → 低稳定性', () => {
    const moves = Array.from({ length: 10 }, (_, i) => move({ winRate: i % 2 === 0 ? 0.55 : 0.45 }));
    const s = computeStrengthSignals(moves);
    expect(s.stability).toBeLessThan(0.5);
  });

  it('大幅下落率：胜率骤降计入（阈值0.08）', () => {
    const moves = [
      move({ winRate: 0.8 }),
      move({ winRate: 0.7 }), // -0.1 < -0.08，大幅下落
      move({ winRate: 0.75 }),
      move({ winRate: 0.65 }), // -0.1 < -0.08，大幅下落
    ];
    const s = computeStrengthSignals(moves);
    expect(s.largeDropRate).toBeCloseTo(2 / 3, 5);
  });

  it('大幅下落率：小变化不计入', () => {
    const moves = Array.from({ length: 10 }, (_, i) => move({ winRate: 0.5 + i * 0.02 }));
    const s = computeStrengthSignals(moves);
    expect(s.largeDropRate).toBe(0);
  });
});

describe('mapScoreToFoxRank', () => {
  it('分数映射到野狐 dan 锚点', () => {
    expect(scoreToFoxDan(0)).toBe(10);
    expect(scoreToFoxDan(50)).toBe(21);
    expect(scoreToFoxDan(100)).toBe(29);
  });

  it('分段插值', () => {
    const d = scoreToFoxDan(55);
    expect(d).toBeGreaterThanOrEqual(21);
    expect(d).toBeLessThanOrEqual(22);
  });

  it('标签口径', () => {
    expect(foxDanToLabel(20)).toBe('野狐 0段');
    expect(foxDanToLabel(25)).toBe('野狐 5段');
    expect(foxDanToLabel(23)).toBe('野狐 3段');
    expect(foxDanToLabel(12)).toBe('野狐 2级');
  });

  it('可信度随样本量变化', () => {
    const low = judgeConfidence(computeStrengthSignals([move({})]));
    const high = judgeConfidence(computeStrengthSignals(
      Array.from({ length: 100 }, (_, i) => move({ winRate: 0.5 + (i % 5) * 0.02, candidates: [{ x: 0, y: 0, winRate: 0.6, scoreLead: 1, visits: 10 }] })),
    ));
    expect(low).toBe('low');
    expect(high).toBe('high');
  });
});

describe('combineSignals + estimatePlayerStrength', () => {
  it('高水平棋手：高命中、少失误、平滑胜率 → 高分段位', () => {
    const moves: PlayerMoveInput[] = Array.from({ length: 100 }, (_, i) => move({
      winRate: 0.55 + i * 0.002,
      isBadMove: false,
      candidates: [{ x: 0, y: 0, winRate: 0.6, scoreLead: 3, visits: 200 }],
    }));
    const est = estimatePlayerStrength('black', moves);
    expect(est.signals.candidateSamples).toBe(100);
    expect(est.signals.agreeTop1).toBe(1);
    expect(est.hasCandidateData).toBe(true);
    expect(est.score).toBeGreaterThan(85);
    expect(est.foxDan).toBeGreaterThanOrEqual(26);
    expect(est.label).toContain('野狐');
  });

  it('弱棋手：大量失误、零命中、胜率震荡 → 低分段位', () => {
    const moves: PlayerMoveInput[] = Array.from({ length: 60 }, (_, i) => move({
      winRate: i % 2 === 0 ? 0.7 : 0.3,
      isBadMove: i % 3 === 0,
      severity: 'severe',
      candidates: [{ x: 9, y: 9, winRate: 0.7, scoreLead: 20, visits: 200 }, { x: 8, y: 8, winRate: 0.6, scoreLead: 10, visits: 100 }],
    }));
    const est = estimatePlayerStrength('white', moves);
    expect(est.signals.mistakeRate).toBeCloseTo(1/3, 1);
    expect(est.signals.agreeTop1).toBe(0);
    expect(est.signals.smoothness).toBe(0);
    expect(est.signals.stability).toBeLessThan(0.5);
    expect(est.score).toBeLessThan(50);
    expect(est.foxDan).toBeLessThanOrEqual(21);
  });

  it('无候选数据时形态信号生效，命中率不加分', () => {
    // 胜率从 0.51 缓慢上升，不穿越 0.5 → 稳定且平滑
    const moves: PlayerMoveInput[] = Array.from({ length: 70 }, (_, i) => move({ winRate: 0.51 + i * 0.003 }));
    const est = estimatePlayerStrength('black', moves);
    expect(est.hasCandidateData).toBe(false);
    expect(est.signals.agreeTop5).toBe(0);
    expect(est.signals.smoothness).toBe(1);
    expect(est.signals.stability).toBe(1);
    expect(est.score).toBeGreaterThan(80);
  });

  it('无候选数据 + 胜率震荡 → 低分', () => {
    const moves: PlayerMoveInput[] = Array.from({ length: 70 }, (_, i) => move({
      winRate: i % 2 === 0 ? 0.65 : 0.35,
      isBadMove: i % 3 === 0,
      severity: 'severe',
    }));
    const est = estimatePlayerStrength('black', moves);
    expect(est.hasCandidateData).toBe(false);
    expect(est.signals.smoothness).toBe(0);
    expect(est.score).toBeLessThan(40);
  });

  it('combineSignals 空样本返回 0', () => {
    expect(combineSignals(computeStrengthSignals([]))).toBe(0);
  });
});
