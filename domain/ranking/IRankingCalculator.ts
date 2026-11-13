import type { RankingInput, RankingOutput, RankingMode } from './types';

/**
 * 内置排名计算器接口（统一管线里的一个实现）
 * @ai-example
 * const calculator: IRankingCalculator = {
 *   rank: (input, mode) => ({ columns: [{ key: 'score', label: '积分' }], rows: [] })
 * };
 */
export interface IRankingCalculator {
  /**
   * 从原始对阵算出排名表内容。与插件的 rank(input) 是同一契约。
   * @param input - 只含最原始对阵表
   * @param mode - 内置实现的预设口径（插件忽略此参数）
   */
  rank(input: RankingInput, mode?: RankingMode): RankingOutput;
}
