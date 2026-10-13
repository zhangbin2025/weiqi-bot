/**
 * 棋力评估分析器单测
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeStrength,
  parseDifficulty,
  parsePuzzleType,
  levelToRank,
  isSeriousAttempt,
} from '../PuzzleStrengthAnalyzer';
import type { PuzzleHistoryEntry } from '../PuzzleHistoryManager';

/** 构造一条历史条目 */
function make(tag: string, success: boolean, opts: Partial<PuzzleHistoryEntry> = {}): PuzzleHistoryEntry {
  return {
    id: `t-${Math.random()}`,
    url: `lib://${tag}-${Math.random()}`,
    title: '题',
    source: 'lib-life-death',
    tag,
    success,
    attempts: 1,
    moves: 2,
    duration: 10000,
    solvedAt: Date.now(),
    boardSize: 19,
    initialStones: [],
    ...opts,
  };
}

/** 生成 n 条同难度、正确率 rate 的题 */
function batch(tag: string, n: number, rate: number): PuzzleHistoryEntry[] {
  const out: PuzzleHistoryEntry[] = [];
  for (let i = 0; i < n; i++) out.push(make(tag, i < Math.round(n * rate)));
  return out;
}

describe('levelToRank', () => {
  it('级位换算：15K=1 … 1K=15', () => {
    expect(levelToRank(1)).toBe('15K');
    expect(levelToRank(15)).toBe('1K');
  });
  it('段位换算：1D=16 … 7D=22', () => {
    expect(levelToRank(16)).toBe('1D');
    expect(levelToRank(22)).toBe('7D');
  });
  it('越界钳制', () => {
    expect(levelToRank(0)).toBe('15K');
    expect(levelToRank(99)).toBe('7D');
  });
});

describe('parseDifficulty', () => {
  it('内置题库标签', () => {
    expect(parseDifficulty('死活题·5D')).toBe(20);
    expect(parseDifficulty('官子题·2D+')).toBe(17.5);
    expect(parseDifficulty('中盘题·1K')).toBe(15);
    expect(parseDifficulty('死活题·15K')).toBe(1);
  });
  it('带 + 加 0.5 级', () => {
    expect(parseDifficulty('死活题·5D+')).toBe(20.5);
    expect(parseDifficulty('死活题·15K+')).toBe(1.5);
  });
  it('中文段级与英文 dan/kyu', () => {
    expect(parseDifficulty('5段')).toBe(20);
    expect(parseDifficulty('5级')).toBe(11);
    expect(parseDifficulty('3 dan')).toBe(18);
    expect(parseDifficulty('15 kyu')).toBe(1);
  });
  it('无难度返回 null', () => {
    expect(parseDifficulty('死活题')).toBeNull();
    expect(parseDifficulty('')).toBeNull();
  });
  it('越界难度返回 null（如 9D / 30K）', () => {
    expect(parseDifficulty('死活题·9D')).toBeNull();
    expect(parseDifficulty('死活题·30K')).toBeNull();
  });
});

describe('parsePuzzleType', () => {
  it('归一化到七类', () => {
    expect(parsePuzzleType('死活题·5D')).toBe('死活');
    expect(parsePuzzleType('官子题·2D+')).toBe('官子');
    expect(parsePuzzleType('布局题')).toBe('布局');
  });
  it('未匹配归其他', () => {
    expect(parsePuzzleType('')).toBe('其他');
    expect(parsePuzzleType('趣味题·3D')).toBe('其他');
  });
});

describe('isSeriousAttempt', () => {
  it('未落子一律排除', () => {
    expect(isSeriousAttempt({ moves: 0, duration: 60000 })).toBe(false);
  });
  it('选点题一手棋：耗时达标才算认真', () => {
    expect(isSeriousAttempt({ moves: 1, duration: 3000 })).toBe(true);
    expect(isSeriousAttempt({ moves: 1, duration: 800 })).toBe(false);
  });
  it('两手及以上不看耗时', () => {
    expect(isSeriousAttempt({ moves: 2, duration: 100 })).toBe(true);
  });
});

describe('analyzeStrength', () => {
  it('空历史：全部零值，综合棋力为 null', () => {
    const r = analyzeStrength([]);
    expect(r.summary.total).toBe(0);
    expect(r.overall).toBeNull();
    expect(r.comment).toContain('有效样本不足');
  });

  it('常规统计：总数/正确率/时间分布', () => {
    const now = Date.now();
    const entries = [
      ...batch('死活题·5D', 6, 1),
      ...batch('死活题·9D', 4, 0),
      make('官子题', false, { solvedAt: now - 40 * 24 * 3600 * 1000 }),
    ];
    const r = analyzeStrength(entries);
    expect(r.summary.total).toBe(11);
    expect(r.summary.success).toBe(6);
    expect(r.summary.failed).toBe(5);
    expect(r.summary.thisMonth).toBe(10);
    // 题型题数按全部历史口径，与题型分布一致
    expect(r.byType.find((t) => t.type === '死活')!.count).toBe(10);
    // 9D 超出 15K~7D 范围 → 难度解析失败，不计入有效样本
    expect(r.byType.find((t) => t.type === '死活')!.rated).toBe(6);
  });

  it('题型题数与题型分布口径一致（含无效样本）', () => {
    const entries = [
      ...batch('官子题·2D', 5, 1),
      make('官子题', true),      // 无难度
      make('官子题·2D', true, { moves: 0 }), // 未落子
    ];
    const r = analyzeStrength(entries);
    const endgame = r.byType.find((t) => t.type === '官子')!;
    expect(endgame.count).toBe(7);
    expect(endgame.rated).toBe(5);
    expect(r.typeDistribution.find((d) => d.label === '官子')!.count).toBe(7);
  });

  it('插值取 50% 通过率对应难度：低段全对、高段全错', () => {
    // 1K(15) 全对、7D(22) 全错 → 棋力应落在两者之间
    const entries = [...batch('死活题·1K', 10, 1), ...batch('死活题·7D', 10, 0)];
    const r = analyzeStrength(entries);
    expect(r.overall).not.toBeNull();
    expect(r.overall!.level).toBeGreaterThan(15);
    expect(r.overall!.level).toBeLessThan(22);
    expect(r.overall!.hitFloor).toBe(false);
    expect(r.overall!.hitCeiling).toBe(false);
  });

  it('天花板：最难题也全对 → hitCeiling 且等级不低于最难题', () => {
    const entries = [...batch('死活题·1K', 5, 1), ...batch('死活题·7D', 5, 1)];
    const r = analyzeStrength(entries);
    expect(r.overall!.hitCeiling).toBe(true);
    expect(r.overall!.level).toBe(22);
    expect(r.overall!.rank).toBe('7D');
  });

  it('天花板：全对 14K/14K+ 只应得出 ≥14K，不应虚高到 13K', () => {
    // 用户实测场景：只做 14K 与 14K+ 且全对。
    // "+" 编码为 +0.5（14.5 级 → 2.5），取整时不得四舍五入成 13K。
    const entries = [...batch('死活题·14K', 6, 1), ...batch('死活题·14K+', 6, 1)];
    const r = analyzeStrength(entries);
    expect(r.overall!.hitCeiling).toBe(true);
    expect(r.overall!.rank).toBe('14K');
    expect(r.overall!.level).toBe(2);
  });

  it('天花板：全对 3D+ 只应得出 ≥3D', () => {
    const entries = batch('死活题·3D+', 10, 1);
    const r = analyzeStrength(entries);
    expect(r.overall!.hitCeiling).toBe(true);
    expect(r.overall!.rank).toBe('3D');
  });

  it('地板：全错 15K+ 不应反向抬到 14K', () => {
    const entries = batch('死活题·15K+', 8, 0);
    const r = analyzeStrength(entries);
    expect(r.overall!.hitFloor).toBe(true);
    expect(r.overall!.rank).toBe('15K');
  });

  it('地板：最易题正确率也不足一半 → hitFloor', () => {
    const entries = [...batch('死活题·15K', 5, 0.2), ...batch('死活题·7D', 5, 0)];
    const r = analyzeStrength(entries);
    expect(r.overall!.hitFloor).toBe(true);
    expect(r.overall!.level).toBe(1);
    expect(r.overall!.rank).toBe('15K');
  });

  it('样本不足：described=false 且点评提示不足', () => {
    const entries = [make('死活题·5D', true), make('死活题·3D', false)];
    const r = analyzeStrength(entries);
    expect(r.overall!.sampleCount).toBe(2);
    expect(r.overall!.described).toBe(false);
    expect(r.overall!.confidence).toBe('low');
  });

  it('置信度分档', () => {
    expect(analyzeStrength(batch('死活题·5D', 25, 0.5)).overall!.confidence).toBe('high');
    expect(analyzeStrength(batch('死活题·5D', 10, 0.5)).overall!.confidence).toBe('medium');
    expect(analyzeStrength(batch('死活题·5D', 3, 0.5)).overall!.confidence).toBe('low');
  });

  it('分题型棋力独立计算', () => {
    const entries = [
      ...batch('死活题·1K', 8, 1),
      ...batch('死活题·6D', 8, 0),
      ...batch('官子题·15K', 8, 0.4),
    ];
    const r = analyzeStrength(entries);
    const life = r.byType.find((t) => t.type === '死活')!;
    const endgame = r.byType.find((t) => t.type === '官子')!;
    expect(life.estimate!.level).toBeGreaterThan(endgame.estimate!.level);
    // 官子全部 15K 且正确率不足一半 → 地板
    expect(endgame.estimate!.hitFloor).toBe(true);
  });

  it('未认真作答与无难度题不参与棋力评估', () => {
    const entries = [
      ...batch('死活题·5D', 10, 1),
      make('死活题·5D', true, { moves: 0 }),          // 未落子
      make('死活题·5D', true, { moves: 1, duration: 500 }), // 秒点
      make('死活题', true),                            // 无难度
    ];
    const r = analyzeStrength(entries);
    expect(r.summary.total).toBe(13);
    expect(r.summary.rated).toBe(10);
    expect(r.summary.unrated).toBe(3);
  });

  it('题型分布按题数降序', () => {
    const entries = [
      ...batch('死活题·5D', 5, 1),
      ...batch('官子题·2D', 9, 1),
      ...batch('中盘题·3D', 1, 1),
    ];
    const r = analyzeStrength(entries);
    expect(r.typeDistribution[0]!.label).toBe('官子');
    expect(r.typeDistribution[0]!.count).toBe(9);
  });

  it('难度档分布：级位题 / 段位题', () => {
    const entries = [...batch('死活题·5K', 4, 1), ...batch('死活题·3D', 6, 0.5)];
    const r = analyzeStrength(entries);
    expect(r.difficultyDistribution).toHaveLength(2);
    expect(r.difficultyDistribution[0]!.label).toBe('级位题');
    expect(r.difficultyDistribution[0]!.count).toBe(4);
    expect(r.difficultyDistribution[1]!.count).toBe(6);
  });

  it('点评：样本充足时指出强弱项', () => {
    const entries = [
      ...batch('死活题·1K', 8, 1),
      ...batch('死活题·6D', 8, 0),
      ...batch('官子题·15K', 8, 0.2),
    ];
    const r = analyzeStrength(entries);
    expect(r.comment).toContain('死活');
    expect(r.comment).toContain('官子');
  });

  it('保序回归：非单调数据不被单个噪声桶带偏', () => {
    // 低难度题（15K/10K）正确率低（随手做的噪声），高难度题反而全对
    // 修复前会被最底部噪声桶带偏成 15K；修复后应由整体趋势主导
    const entries = [
      ...batch('官子题·15K', 6, 0.2),
      ...batch('官子题·10K', 6, 0.3),
      ...batch('死活题·5D', 8, 1),
      ...batch('死活题·6D', 8, 1),
    ];
    const r = analyzeStrength(entries);
    expect(r.overall).not.toBeNull();
    // 死活占多数且全对，综合棋力应明显高于级位区间
    expect(r.overall!.level).toBeGreaterThan(15);
    expect(r.overall!.hitFloor).toBe(false);
  });

  it('保序回归：单调数据结论不变（低段全对、高段全错）', () => {
    const entries = [
      ...batch('死活题·1K', 8, 1),
      ...batch('死活题·3D', 8, 0.8),
      ...batch('死活题·5D', 8, 0.3),
      ...batch('死活题·7D', 8, 0),
    ];
    const r = analyzeStrength(entries);
    expect(r.overall!.level).toBeGreaterThan(15);
    expect(r.overall!.level).toBeLessThan(21);
    expect(r.overall!.hitFloor).toBe(false);
    expect(r.overall!.hitCeiling).toBe(false);
  });

  it('点评：均衡时不点名强弱', () => {
    const entries = [
      ...batch('死活题·1K', 8, 1),
      ...batch('死活题·6D', 8, 0),
      ...batch('官子题·1K', 8, 1),
      ...batch('官子题·6D', 8, 0),
    ];
    const r = analyzeStrength(entries);
    expect(r.comment).toContain('均衡');
  });
});
