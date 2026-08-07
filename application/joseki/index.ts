/**
 * 定式应用层导出
 */
export {
  JosekiDiscoverApp,
  type DiscoverResult,
  type DiscoverHistoryOptions,
  type DiscoverHistoryEntry,
  type DiscoverStats,
} from './JosekiDiscoverApp';
export {
  DiscoverHistoryManager,
  type GameInfo,
} from './discover/DiscoverHistoryManager';
export {
  JosekiExploreApp,
  type ExploreResult,
  type ExploreProgressCallback,
  type FavoriteQueryOptions,
  type FavoriteEntry,
  type FavoriteStats,
} from './JosekiExploreApp';
export {
  ExploreFavoritesManager,
} from './explore/ExploreFavoritesManager';
export {
  JosekiQuizApp,
  type QuizOptions,
  type QuizQuestion,
  type QuizLoadProgressCallback,
  type ChallengeResult,
  type QuizHistoryOptions,
  type QuizHistoryEntry,
  type QuizStats,
} from './JosekiQuizApp';
export {
  QuizHistoryManager,
} from './quiz/QuizHistoryManager';