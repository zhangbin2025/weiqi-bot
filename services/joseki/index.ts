/**
 * 定式服务统一导出
 */

// Loader
export { JosekiLoader } from './JosekiLoader';
export { JosekiQuizLoader } from './JosekiQuizLoader';
export { GzipJsonLoader } from './GzipJsonLoader';
export type { IJosekiLoader, IJosekiMeta } from './IJosekiLoader';

// Explore
export { JosekiExploreService } from './explore/JosekiExploreService';
export type {
  IJosekiExploreService,
  IExploreResult,
  IExploreStats,
} from './explore/IJosekiExploreService';

// Discover
export { JosekiDiscoverService } from './discover/JosekiDiscoverService';
export type { IJosekiDiscoverService, IDiscoverResult } from './discover/IJosekiDiscoverService';
export type { IDiscoveredPattern } from './discover/types';

// Quiz
export { JosekiQuizService } from './quiz/JosekiQuizService';
export type { IJosekiQuizService, IQuizQuestion, IQuizOptions } from './quiz/IJosekiQuizService';
