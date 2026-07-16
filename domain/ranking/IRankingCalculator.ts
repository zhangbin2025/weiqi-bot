import type { MatchData, PlayerRanking, RankingResult, RankingMode } from './types';

/**
 * 排名计算器接口
 * @ai-example
 * const calculator: IRankingCalculator = {
 *   calculate: (matches, mode) => ({ rankings: [], totalRounds: 5, completedRounds: 3 })
 * };
 */
export interface IRankingCalculator {
  /**
   * 计算排名
   * @param matches - 所有轮次对阵数据
   * @param mode - 排名模式（default 使用累进分，simple 不使用累进分）
   * @returns 排名结果
   */
  calculate(matches: MatchData[], mode?: RankingMode): RankingResult;
}