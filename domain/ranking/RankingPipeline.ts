/**
 * 统一排名管线
 * @module domain/ranking/RankingPipeline
 *
 * 只有一条管线：computeRanking(matches, impl) → RankingTable。
 * impl 是唯一可变点：内置实现与插件实现都只实现 rank({ matches }) → { columns, rows }。
 * API、PDF 导入、CLI、详情页都只提供最原始的对阵表，经同一管线算出积分与排名。
 *
 * 管线本身负责两件与实现无关的事：
 * 1) 用 validateRankingOutput 约束输出（cells 为数值/数值数组 + 汉字列名 + 选手身份一致）
 * 2) 用 deriveRounds 从同一份对阵补 totalRounds / completedRounds
 */

import type {
  MatchData, RankingInput, RankingOutput, RankingTable, RankingMode,
} from './types';
import { validateRankingOutput, toRankingTable } from './RankingTable';
import { RankingCalculator } from './RankingCalculator';
import type { IRankingCalculator } from './IRankingCalculator';

/** 排名实现：内置与插件共用这一个方法签名，别无其它入口 */
export interface IRankingImplementation {
  rank(input: RankingInput): RankingOutput | Promise<RankingOutput>;
}

/** 实现产出的内容不符合统一契约 */
export class RankingContractError extends Error {
  readonly missingFields: string[];
  constructor(hint: string, missingFields: string[] = []) {
    super(hint);
    this.name = 'RankingContractError';
    this.missingFields = missingFields;
  }
}

/** 唯一管线。所有来源（API / PDF / CLI / 内置 / 插件）最终都调这里。 */
export async function computeRanking(
  matches: MatchData[],
  impl: IRankingImplementation,
): Promise<RankingTable> {
  const input: RankingInput = { matches };
  const output = await impl.rank(input);
  const check = validateRankingOutput(output, input);
  if (!check.ok) {
    throw new RankingContractError(check.hint ?? '排名输出不符合统一契约', check.missingFields);
  }
  return toRankingTable(output, matches);
}

/** 内置实现：把 RankingCalculator 包装成统一管线里的一个 impl。mode 只是内置预设口径。 */
export class BuiltinRanking implements IRankingImplementation {
  constructor(
    private readonly mode: RankingMode = 'default',
    private readonly calculator: IRankingCalculator = new RankingCalculator(),
  ) {}

  rank(input: RankingInput): RankingOutput {
    return this.calculator.rank(input, this.mode);
  }
}
