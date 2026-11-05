/**
 * 排名插件适配层
 * @module application/plugin/RankingPluginAdapter
 *
 * 把「内置排名结果」作为只读输入交给插件，插件返回带 rank 的数组，
 * 再按 rank 重排并回填到 RankingResult。任何失败一律回落到内置结果，
 * 保证页面不白屏。
 */

import type { IPluginRuntime } from '@domain/plugin/types';
import { RANKING_SPEC } from '@domain/plugin/types';
import type { RankingResult, PlayerRanking } from '@domain/ranking/types';

export interface RankingPluginAdapterOptions {
  runtime: IPluginRuntime;
}

/** 插件返回的行：至少要有 rank，其余字段透传 */
interface RankedRow extends Record<string, unknown> {
  rank: number;
}

function isRankedRow(value: unknown): value is RankedRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof (value as Record<string, unknown>)['rank'] === 'number';
}

/**
 * 执行排名插件。返回 null 表示应回落到内置实现。
 */
export async function applyRankingPlugin(
  code: string,
  builtin: RankingResult,
  options: RankingPluginAdapterOptions,
): Promise<RankingResult | null> {
  const input: PlayerRanking[] = builtin.rankings.map((p) => ({ ...p }));
  const spec = RANKING_SPEC;

  let output: unknown;
  try {
    const result = await options.runtime.run(code, input, spec);
    if (!result.ok) return null;
    output = result.output;
  } catch {
    return null;
  }

  if (!Array.isArray(output)) return null;
  if (output.length !== input.length) return null;
  if (!output.every(isRankedRow)) return null;

  // 用插件给的 rank 重排（稳定排序，避免同 rank 抖动）
  const sorted = [...output].sort((a, b) => a.rank - b.rank);
  const byId = new Map<number, PlayerRanking>();
  for (const p of input) byId.set(p.id, p);

  const rankings: PlayerRanking[] = [];
  for (const row of sorted) {
    // 插件可能返回裁剪过的行；以内置数据为底，只覆盖 rank 与插件显式给出的字段
    const id = row['id'];
    if (typeof id !== 'number') return null;
    const base = byId.get(id);
    if (!base) return null;
    const merged: PlayerRanking = {
      ...base,
      rank: row.rank,
    };
    // 允许插件补充任意展示字段（供 formatter 数据驱动），但不覆盖核心统计字段
    if (typeof row['directWin'] === 'string') merged.directWin = row['directWin'];
    if (typeof row['reverseMinusDisplay'] === 'string') merged.reverseMinusDisplay = row['reverseMinusDisplay'];
    rankings.push(merged);
  }

  return {
    rankings,
    totalRounds: builtin.totalRounds,
    completedRounds: builtin.completedRounds,
  };
}
