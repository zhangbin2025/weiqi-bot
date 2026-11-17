import type { RankingInput, RankingOutput } from './types';

/**
 * 内置排名计算器接口（统一管线里的一个实现）
 * @ai-example
 * const calculator: IRankingCalculator = {
 *   rank: (input) => ({ columns: [{ key: 'score', label: '积分' }], rows: [] })
 * };
 */
export interface IRankingCalculator {
  /** 从原始对阵算出排名表内容。与插件的 rank(input) 是同一契约。 */
  rank(input: RankingInput): RankingOutput;
}
