import { describe, it, expect, vi } from 'vitest';
import { createPluginRanking, RankingPluginExecutionError } from '../RankingPluginAdapter';
import type { IPluginRuntime, PluginRunResult } from '@domain/plugin/types';
import { RANKING_SPEC } from '@domain/plugin/types';
import { computeRanking } from '@domain/ranking/RankingPipeline';
import { SAMPLE_RANKING_INPUT } from '@domain/ranking/sampleInput';

function runtime(result: PluginRunResult): IPluginRuntime {
  return { run: vi.fn().mockResolvedValue(result), dispose: vi.fn() };
}

const ok = (output: unknown): PluginRunResult => ({ ok: true, output, logs: [], elapsedMs: 1 });
const fail = (phase: 'runtime' | 'timeout' = 'runtime'): PluginRunResult => ({
  ok: false, phase, error: { name: 'E', message: 'x' }, logs: [], elapsedMs: 1,
});

/** 合法输出：覆盖样例对阵 3 人，cells 数值（含一列数值数组） */
const validOutput = {
  columns: [
    { key: 'score', label: '积分' },
    { key: 'reverse', label: '逆减' },
  ],
  rows: [
    { id: 1, name: '甲', rank: 1, cells: { score: 4, reverse: [3, 12] } },
    { id: 2, name: '乙', rank: 2, cells: { score: 2, reverse: [1, 5] } },
    { id: 3, name: '丙', rank: 3, cells: { score: 2, reverse: [1, 3] } },
  ],
};

const impl = (code: string, r: IPluginRuntime) => createPluginRanking(code, { runtime: r });

describe('PluginRanking（统一管线里的插件实现）', () => {
  it('把沙箱输出原样作为 RankingOutput，交给 computeRanking 校验 + 派生轮次', async () => {
    const r = runtime(ok(validOutput));
    const table = await computeRanking(SAMPLE_RANKING_INPUT.matches, impl('code', r));
    expect(table.columns.map((c) => c.label)).toEqual(['积分', '逆减']);
    expect(table.rows.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(table.rows[0]!.cells['reverse']).toEqual([3, 12]); // 数值数组原样透传
    expect(table.totalRounds).toBe(3);
    // 第 3 轮比分全 0（未完赛）→ completedRounds=2
    expect(table.completedRounds).toBe(2);
    // 传给沙箱的就是原始对阵（唯一数据源），不是内置排名结果
    const passed = (r.run as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(passed).toEqual(SAMPLE_RANKING_INPUT);
  });

  it('插件执行失败抛 RankingPluginExecutionError（上层据此回落内置）', async () => {
    const r = runtime(fail());
    await expect(computeRanking(SAMPLE_RANKING_INPUT.matches, impl('code', r)))
      .rejects.toBeInstanceOf(RankingPluginExecutionError);
  });

  it('沙箱抛异常同样抛 RankingPluginExecutionError', async () => {
    const r = { run: vi.fn().mockRejectedValue(new Error('dead')), dispose: vi.fn() } as unknown as IPluginRuntime;
    await expect(computeRanking(SAMPLE_RANKING_INPUT.matches, impl('code', r)))
      .rejects.toThrow(RankingPluginExecutionError);
  });

  it('输出不符合契约 → computeRanking 抛 RankingContractError，不静默通过', async () => {
    for (const output of [
      { foo: 1 }, // 不是 { columns, rows }
      [], // 数组旧契约
      { columns: [], rows: [] }, // 无列
      { columns: [{ key: 'score', label: 'Score' }], rows: [] }, // 列名非汉字
      { columns: [{ key: 'score', label: '积分' }], rows: validOutput.rows.map((x) => ({ ...x, cells: { score: '4' } })) }, // 字符串 cell
    ]) {
      const r = runtime(ok(output));
      await expect(computeRanking(SAMPLE_RANKING_INPUT.matches, impl('code', r)))
        .rejects.toThrow();
    }
  });

  it('插件自定义列（加列/删列/改名）全部由 columns + cells 决定，宿主不预置字段', async () => {
    const custom = {
      columns: [{ key: 'myWins', label: '胜局数' }],
      rows: validOutput.rows.map((x) => ({ ...x, cells: { myWins: 2 } })),
    };
    const r = runtime(ok(custom));
    const table = await computeRanking(SAMPLE_RANKING_INPUT.matches, impl('code', r));
    expect(table.columns).toEqual([{ key: 'myWins', label: '胜局数' }]);
    expect(table.rows[0]!.cells).toEqual({ myWins: 2 });
  });

  it('默认使用 RANKING_SPEC（单入口 rank / 零能力）', async () => {
    const r = runtime(ok(validOutput));
    await computeRanking(SAMPLE_RANKING_INPUT.matches, impl('code', r));
    const passedSpec = (r.run as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    expect(passedSpec).toEqual(RANKING_SPEC);
    expect(passedSpec.entry).toBe('rank');
    expect(passedSpec.hostApi).toEqual([]);
  });
});
