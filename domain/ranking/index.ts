/**
 * 排名模块
 * @module domain/ranking
 *
 * 唯一原始数据源是「对阵表」。内置实现与插件实现共用同一契约与同一条管线：
 * computeRanking(matches, impl) → RankingTable{ columns, rows, totalRounds, completedRounds }。
 */

export type {
  MatchData, RankingInput, RankingColumn, RankingRow, RankingOutput,
  RankingTable, RankingMode, PlayerGame, InternalPlayer, RankingCellValue,
} from './types';
export type { IRankingCalculator } from './IRankingCalculator';
export { RankingCalculator } from './RankingCalculator';
export { GroupSelector } from './GroupSelector';
export {
  validateRankingOutput, deriveRounds, toRankingTable,
  isRankingCellValue, formatRankingCell,
} from './RankingTable';
export type { RankingTableCheck } from './RankingTable';
export { computeRanking, BuiltinRanking, RankingContractError } from './RankingPipeline';
export type { IRankingImplementation } from './RankingPipeline';
export { buildPlayerGames, buildScoreMap, buildRankMap, cleanName } from './MatchDerived';
export { SAMPLE_RANKING_INPUT } from './sampleInput';
