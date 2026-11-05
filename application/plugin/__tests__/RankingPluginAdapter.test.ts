import { describe, it, expect, vi } from 'vitest';
import { applyRankingPlugin } from '../RankingPluginAdapter';
import type { IPluginRuntime, PluginRunResult } from '@domain/plugin/types';
import type { RankingResult } from '@domain/ranking/types';

function builtin(): RankingResult {
  return {
    totalRounds: 3,
    completedRounds: 3,
    rankings: [
      { id: 1, name: 'A', rank: 1, score: 6, opponentScore: 10, progressiveScore: 12, reverseMinus: [], reverseMinusDisplay: '', wins: 3, losses: 0, draws: 0 },
      { id: 2, name: 'B', rank: 2, score: 4, opponentScore: 9, progressiveScore: 10, reverseMinus: [], reverseMinusDisplay: '', wins: 2, losses: 1, draws: 0 },
      { id: 3, name: 'C', rank: 3, score: 2, opponentScore: 8, progressiveScore: 8, reverseMinus: [], reverseMinusDisplay: '', wins: 1, losses: 2, draws: 0 },
    ],
  };
}

function runtime(result: PluginRunResult): IPluginRuntime {
  return { run: vi.fn().mockResolvedValue(result), dispose: vi.fn() };
}

const ok = (output: unknown): PluginRunResult => ({ ok: true, output, logs: [], elapsedMs: 1 });
const fail = (phase: 'runtime' | 'timeout' = 'runtime'): PluginRunResult => ({
  ok: false, phase, error: { name: 'E', message: 'x' }, logs: [], elapsedMs: 1,
});

describe('applyRankingPlugin', () => {
  it('按插件给的 rank 重排并返回完整 RankingResult', async () => {
    const r = runtime(ok([
      { id: 3, rank: 1 }, { id: 1, rank: 2 }, { id: 2, rank: 3 },
    ]));
    const result = await applyRankingPlugin('code', builtin(), { runtime: r });
    expect(result).not.toBeNull();
    expect(result!.rankings.map((p) => p.id)).toEqual([3, 1, 2]);
    expect(result!.rankings.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(result!.totalRounds).toBe(3);
    expect(result!.completedRounds).toBe(3);
    // 核心统计字段保留
    expect(result!.rankings[0].score).toBe(2);
  });

  it('插件执行失败返回 null（回落内置）', async () => {
    expect(await applyRankingPlugin('code', builtin(), { runtime: runtime(fail()) })).toBeNull();
  });

  it('沙箱抛异常返回 null', async () => {
    const r = { run: vi.fn().mockRejectedValue(new Error('dead')), dispose: vi.fn() } as unknown as IPluginRuntime;
    expect(await applyRankingPlugin('code', builtin(), { runtime: r })).toBeNull();
  });

  it('输出不是数组 / 长度不符 / 缺 rank 都返回 null', async () => {
    for (const output of [
      { foo: 1 },
      [{ id: 1, rank: 1 }],
      [{ id: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 }],
      [{ id: 1, rank: 'x' }, { id: 2, rank: 2 }, { id: 3, rank: 3 }],
    ]) {
      expect(await applyRankingPlugin('code', builtin(), { runtime: runtime(ok(output)) })).toBeNull();
    }
  });

  it('id 不认识 / 不是数字时返回 null（防伪造行）', async () => {
    expect(await applyRankingPlugin('code', builtin(), {
      runtime: runtime(ok([{ id: 99, rank: 1 }, { id: 1, rank: 2 }, { id: 2, rank: 3 }])),
    })).toBeNull();
    expect(await applyRankingPlugin('code', builtin(), {
      runtime: runtime(ok([{ id: '1', rank: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 }])),
    })).toBeNull();
  });

  it('插件可覆盖展示字段但不覆盖核心统计', async () => {
    const result = await applyRankingPlugin('code', builtin(), {
      runtime: runtime(ok([
        { id: 1, rank: 1, score: 999, directWin: '胜B', reverseMinusDisplay: '3-12' },
        { id: 2, rank: 2 }, { id: 3, rank: 3 },
      ])),
    });
    expect(result!.rankings[0].score).toBe(6); // 不被 999 污染
    expect(result!.rankings[0].directWin).toBe('胜B');
    expect(result!.rankings[0].reverseMinusDisplay).toBe('3-12');
  });

  it('传给插件的是副本，插件改不到内置结果', async () => {
    const b = builtin();
    const r = runtime(ok([{ id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 }]));
    await applyRankingPlugin('code', b, { runtime: r });
    const passed = (r.run as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Array<{ score: number }>;
    passed[0].score = 999;
    expect(b.rankings[0].score).toBe(6);
  });
});
