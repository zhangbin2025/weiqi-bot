import { describe, it, expect } from 'vitest';
import { normalizePlayerIds } from '../PlayerIds';
import { validateEventDraft } from '../EventDraft';
import { recalcWinLoss } from '../WinLoss';
import { RankingCalculator } from '../../../domain/ranking/RankingCalculator';
import type { Match } from '../types';

const mk = (
  bout: number, table: number,
  p1Name: string, p1Id: number, p1Score: number,
  p2Name: string, p2Id: number, p2Score: number,
): Match => ({ bout, table, p1Name, p1Id, p1Score, p2Name, p2Id, p2Score });

describe('normalizePlayerIds', () => {
  it('同名沿用同一 id，正常数据（编号不撞）保持原 id 不变', () => {
    const rounds = [{ matches: [
      mk(1, 1, '甲', 1, 2, '乙', 2, 0),
      mk(2, 1, '甲', 1, 0, '丙', 3, 0),
      mk(2, 2, '乙', 2, 0, '丙', 3, 0),
    ]}];
    normalizePlayerIds(rounds);
    expect(rounds[0]!.matches.map(m => [m.p1Name, m.p1Id, m.p2Name, m.p2Id])).toEqual([
      ['甲', 1, '乙', 2],
      ['甲', 1, '丙', 3],
      ['乙', 2, '丙', 3],
    ]);
  });

  it('分轮导入临时编号撞车：不同姓名必须拿到不同 id', () => {
    // 第1轮：甲=1 乙=2 丙=3 丁=4；第2轮重新编排：甲=1 丙′=2 乙=3 丁=4
    // 乙 与 丙′ 都=2 → 旧 fixPlayerIds 会把两人合并成一行
    const rounds = [{ matches: [
      mk(1, 1, '甲', 1, 2, '乙', 2, 0),
      mk(1, 2, '丙', 3, 2, '丁', 4, 0),
      mk(2, 1, '甲', 1, 0, '丙′', 2, 0),
      mk(2, 2, '乙', 3, 0, '丁', 4, 0),
    ]}];
    normalizePlayerIds(rounds);
    const ids = new Map<string, number>();
    for (const m of rounds[0]!.matches) {
      ids.set(m.p1Name, m.p1Id);
      ids.set(m.p2Name, m.p2Id);
    }
    expect(new Set(ids.values()).size).toBe(ids.size);
    expect(ids.get('乙')).not.toBe(ids.get('丙′'));
    expect(ids.get('甲')).toBe(1); // 首次出现的原 id 尽量沿用
  });

  it('无编号 / 轮空：空姓名不分配 id，0 编号换成互不相同的负数', () => {
    const rounds = [{ matches: [
      mk(1, 1, '甲', 0, 2, '', 0, 0),
      mk(1, 2, '乙', 0, 0, '丙', 0, 0),
    ]}];
    normalizePlayerIds(rounds);
    const m0 = rounds[0]!.matches[0]!;
    const m1 = rounds[0]!.matches[1]!;
    expect(m0.p2Id).toBe(0);
    expect(m0.p2Name).toBe('');
    expect(new Set([m0.p1Id, m1.p1Id, m1.p2Id]).size).toBe(3);
    expect(m0.p1Id).toBeLessThan(0);
    expect(m1.p1Id).toBeLessThan(0);
    expect(m1.p2Id).toBeLessThan(0);
  });

  it('回归：两次真实导入后，不再出现「积分4/累进分14」的合并行', () => {
    const d1 = validateEventDraft({ title: '测试杯', groupName: '公开组', round: 1, matches: [
      { table: 1, p1Name: '甲', p1Score: 0, p2Name: '乙', p2Score: 0 },
      { table: 2, p1Name: '丙', p1Score: 0, p2Name: '丁', p2Score: 0 },
    ]});
    const d2 = validateEventDraft({ title: '测试杯', groupName: '公开组', round: 2, matches: [
      { table: 1, p1Name: '甲', p1Score: 2, p2Name: '丙', p2Score: 2 },
      { table: 2, p1Name: '乙', p1Score: 0, p2Name: '丁', p2Score: 0 },
    ]});
    if (!d1.ok || !d2.ok) throw new Error('草稿校验失败');
    const rounds = [
      { round: 1, matches: d1.draft.matches, pdfScores: d1.draft.pdfScores },
      { round: 2, matches: d2.draft.matches, pdfScores: d2.draft.pdfScores },
    ];
    recalcWinLoss({ rounds });
    normalizePlayerIds(rounds);

    const rows = new RankingCalculator().rank(
      { matches: rounds.flatMap(r => r.matches) },
    ).rows;
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.cells['score'] !== 4)).toBe(true);
    expect(rows.every(r => r.cells['progressiveScore'] !== 14)).toBe(true);
    expect(rows.filter(r => r.cells['score'] === 2)).toHaveLength(2);
  });

  it('回归：两名各赢1场的人临时编号撞车时，不会被合并出 4 分', () => {
    const matches: Match[] = [
      mk(1, 1, 'A', 1, 2, 'X', 3, 0),
      mk(1, 2, 'B', 1, 2, 'Y', 4, 0), // B 与 A 临时 id 都是 1
      mk(2, 1, 'A', 1, 0, 'B', 1, 0),
      mk(2, 2, 'X', 3, 0, 'Y', 4, 0),
    ];
    normalizePlayerIds([{ matches }]);
    const rows = new RankingCalculator().rank({ matches }).rows;
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.cells['score'] !== 4)).toBe(true);
  });
});


  it('端到端：两次导入 + 第2轮姓名变体撞号，修复前出现 4/14，修复后消失', () => {
    // 逐字复刻修复前的 fixPlayerIds，用作对照
    const oldFix = (rounds: Array<{ matches: Match[] }>): void => {
      const nameToId = new Map<string, number>();
      for (const r of rounds) for (const m of r.matches) {
        if (m.p1Name && m.p1Id && !nameToId.has(m.p1Name)) nameToId.set(m.p1Name, m.p1Id);
        if (m.p2Name && m.p2Id && !nameToId.has(m.p2Name)) nameToId.set(m.p2Name, m.p2Id);
      }
      let fakeId = -1;
      for (const r of rounds) for (const m of r.matches) for (const n of [m.p1Name, m.p2Name]) {
        if (n && !nameToId.has(n)) nameToId.set(n, fakeId--);
      }
      for (const r of rounds) for (const m of r.matches) {
        if (m.p1Name && nameToId.has(m.p1Name)) m.p1Id = nameToId.get(m.p1Name)!;
        if (m.p2Name && nameToId.has(m.p2Name)) m.p2Id = nameToId.get(m.p2Name)!;
      }
    };

    const d1 = validateEventDraft({ title: 'T', groupName: '公开组', round: 1, matches: [
      { table: 1, p1Name: 'A', p1Score: 0, p2Name: 'X', p2Score: 0 },
      { table: 2, p1Name: 'B', p1Score: 0, p2Name: 'Y', p2Score: 0 },
      { table: 3, p1Name: 'C', p1Score: 0, p2Name: 'P', p2Score: 0 },
      { table: 4, p1Name: 'D', p1Score: 0, p2Name: 'Q', p2Score: 0 },
    ]});
    const d2 = validateEventDraft({ title: 'T', groupName: '公开组', round: 2, matches: [
      { table: 1, p1Name: 'B′', p1Score: 2, p2Name: 'A', p2Score: 2 },
      { table: 2, p1Name: 'C', p1Score: 2, p2Name: 'D', p2Score: 2 },
      { table: 3, p1Name: 'X', p1Score: 0, p2Name: 'Y', p2Score: 0 },
      { table: 4, p1Name: 'P', p1Score: 0, p2Name: 'Q', p2Score: 0 },
    ]});
    if (!d1.ok || !d2.ok) throw new Error('草稿校验失败');
    const mkRounds = () => [
      { round: 1, matches: d1.draft.matches.map(m => ({ ...m })), pdfScores: { ...d1.draft.pdfScores } },
      { round: 2, matches: d2.draft.matches.map(m => ({ ...m })), pdfScores: { ...d2.draft.pdfScores } },
    ];

    const before = mkRounds();
    recalcWinLoss({ rounds: before });
    oldFix(before);
    const beforeRows = new RankingCalculator().rank(
      { matches: before.flatMap(r => r.matches) },
    ).rows;
    // 修复前：两个临时 id 相同的赢家被合并 → 4 分 / 累进分 14
    expect(beforeRows.some(r => r.cells['score'] === 4 && r.cells['progressiveScore'] === 14)).toBe(true);

    const after = mkRounds();
    recalcWinLoss({ rounds: after });
    normalizePlayerIds(after);
    const afterRows = new RankingCalculator().rank(
      { matches: after.flatMap(r => r.matches) },
    ).rows;
    expect(afterRows.some(r => r.cells['score'] === 4)).toBe(false);
    expect(afterRows.some(r => r.cells['progressiveScore'] === 14)).toBe(false);
    expect(afterRows.filter(r => r.cells['score'] === 2)).toHaveLength(4);
  });
