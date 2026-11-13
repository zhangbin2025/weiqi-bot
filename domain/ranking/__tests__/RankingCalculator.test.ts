import { describe, it, expect } from 'vitest';
import { RankingCalculator } from '../RankingCalculator';
import { computeRanking, BuiltinRanking } from '../RankingPipeline';
import { validateRankingOutput, formatRankingCell } from '../RankingTable';
import type { MatchData, RankingTable, RankingMode } from '../types';

const calculator = new RankingCalculator();

/** 经统一管线：内置实现 → 结构校验 → 派生轮次 */
async function table(matches: MatchData[], mode: RankingMode = 'default'): Promise<RankingTable> {
  return computeRanking(matches, new BuiltinRanking(mode, calculator));
}

/** 取某选手某列的 cells 值 */
function cell(t: RankingTable, id: number, key: string): number | number[] | undefined {
  return t.rows.find((r) => r.id === id)?.cells[key];
}

describe('RankingCalculator（统一管线里的内置实现）', () => {
  describe('空对阵', () => {
    it('产出空 rows、列仍由内置口径给出，轮次元信息为 0', async () => {
      const t = await table([]);
      expect(t.rows).toEqual([]);
      expect(t.totalRounds).toBe(0);
      expect(t.completedRounds).toBe(0);
      expect(t.columns.map((c) => c.label)).toEqual(['积分', '对手分', '累进分', '逆减']);
    });
  });

  describe('基本排名', () => {
    const matches: MatchData[] = [
      // 第1轮 A 胜 B，C 胜 D
      { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
      { bout: 1, p1Id: 3, p1Name: 'C', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
      // 第2轮 A 胜 C，B 胜 D
      { bout: 2, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 3, p2Name: 'C', p2Score: 0 },
      { bout: 2, p1Id: 2, p1Name: 'B', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
      // 第3轮 A 胜 D，B 胜 C
      { bout: 3, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
      { bout: 3, p1Id: 2, p1Name: 'B', p1Score: 2, p2Id: 3, p2Name: 'C', p2Score: 0 },
    ];

    it('产出结构符合统一契约（内部实现也要过校验）', () => {
      const out = calculator.rank({ matches });
      expect(validateRankingOutput(out, { matches }).ok).toBe(true);
    });

    it('积分列：A6 B4 C2 D0', async () => {
      const t = await table(matches);
      expect(cell(t, 1, 'score')).toBe(6);
      expect(cell(t, 2, 'score')).toBe(4);
      expect(cell(t, 3, 'score')).toBe(2);
      expect(cell(t, 4, 'score')).toBe(0);
    });

    it('按积分降序排 rank', async () => {
      const t = await table(matches);
      expect(t.rows.map((r) => r.cells['score'])).toEqual([6, 4, 2, 0]);
      expect(t.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    });

    it('对手分（SOS）：A 的对手 B4+C2+D0 = 6', async () => {
      const t = await table(matches);
      expect(cell(t, 1, 'opponentScore')).toBe(6);
    });

    it('累进分：A 逐轮 2+4+6 = 12', async () => {
      const t = await table(matches);
      expect(cell(t, 1, 'progressiveScore')).toBe(12);
    });

    it('轮次元信息由管线从对阵派生', async () => {
      const t = await table(matches);
      expect(t.totalRounds).toBe(3);
      expect(t.completedRounds).toBe(3);
    });

    it('列名为纯汉字、cells 值全为有限数值或数值数组', async () => {
      const t = await table(matches);
      for (const c of t.columns) expect(/^[\u4e00-\u9fa5]{1,12}$/.test(c.label)).toBe(true);
      for (const r of t.rows) {
        for (const c of t.columns) {
          const v = r.cells[c.key];
          if (Array.isArray(v)) expect(v.every(Number.isFinite)).toBe(true);
          else expect(Number.isFinite(v)).toBe(true);
        }
      }
    });
  });

  describe('和棋', () => {
    const matches: MatchData[] = [
      { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 1, p2Id: 2, p2Name: 'B', p2Score: 1 },
    ];
    it('双方各得 1 分', async () => {
      const t = await table(matches);
      expect(cell(t, 1, 'score')).toBe(1);
      expect(cell(t, 2, 'score')).toBe(1);
    });
  });

  describe('未完赛轮次', () => {
    const matches: MatchData[] = [
      { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
      { bout: 2, p1Id: 1, p1Name: 'A', p1Score: 0, p2Id: 2, p2Name: 'B', p2Score: 0 },
    ];
    it('比分全 0 的轮次不计入 completedRounds', async () => {
      const t = await table(matches);
      expect(t.totalRounds).toBe(2);
      expect(t.completedRounds).toBe(1);
    });
  });

  describe('simple 口径', () => {
    const matches: MatchData[] = [
      { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
      { bout: 1, p1Id: 3, p1Name: 'C', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
      { bout: 2, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 3, p2Name: 'C', p2Score: 0 },
      { bout: 2, p1Id: 2, p1Name: 'B', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
    ];
    it('不产累进分列，但仍覆盖 4 人', async () => {
      const t = await table(matches, 'simple');
      expect(t.rows.length).toBe(4);
      expect(t.columns.map((c) => c.key)).not.toContain('progressiveScore');
    });
  });

  describe('directWin 口径', () => {
    it('追加「直胜」列，值为纯数值 1/0/-1', async () => {
      const matches: MatchData[] = [
        { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
      ];
      const t = await table(matches, 'directWin');
      expect(t.columns.map((c) => c.label)).toContain('直胜');
      expect(typeof cell(t, 1, 'directWin')).toBe('number');
    });
  });

  describe('逆减数组（16:09 澄清：cells 允许数值数组）', () => {
    it('非同分选手逆减为空数组（渲染不显示内容）', async () => {
      const t = await table([
        { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
      ]);
      expect(Array.isArray(cell(t, 1, 'reverseMinus'))).toBe(true);
      expect(formatRankingCell(cell(t, 1, 'reverseMinus'))).toBe('');
    });

    it('同分选手逆减是数值数组，formatRankingCell 用 - 连接（3-12）', () => {
      expect(formatRankingCell([3, 12])).toBe('3-12');
      expect(formatRankingCell(6)).toBe('6');
      expect(formatRankingCell([])).toBe('');
    });
  });

  describe('校验器拒绝非法输出', () => {
    const matches: MatchData[] = [
      { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
    ];
    it('cells 含字符串 → 拒绝', () => {
      const out = {
        columns: [{ key: 'score', label: '积分' }],
        rows: [
          { id: 1, name: 'A', rank: 1, cells: { score: '6' } },
          { id: 2, name: 'B', rank: 2, cells: { score: 0 } },
        ],
      };
      expect(validateRankingOutput(out, { matches }).ok).toBe(false);
    });
    it('cells 含数值数组 → 通过', () => {
      const out = {
        columns: [{ key: 'score', label: '积分' }, { key: 'rm', label: '逆减' }],
        rows: [
          { id: 1, name: 'A', rank: 1, cells: { score: 2, rm: [3, 12] } },
          { id: 2, name: 'B', rank: 2, cells: { score: 0, rm: [] } },
        ],
      };
      expect(validateRankingOutput(out, { matches }).ok).toBe(true);
    });
    it('name 被改写 / 新增选手 → 拒绝', () => {
      const out = {
        columns: [{ key: 'score', label: '积分' }],
        rows: [
          { id: 1, name: '改名', rank: 1, cells: { score: 2 } },
          { id: 2, name: 'B', rank: 2, cells: { score: 0 } },
        ],
      };
      expect(validateRankingOutput(out, { matches }).ok).toBe(false);
    });
  });
});
