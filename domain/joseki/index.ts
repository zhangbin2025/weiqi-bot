// 角定式提取
export type { ICornerMove, ICornerSequence, IFourCornersResult } from './ICornerSequence';
export type { ICornerExtractor, RawMove } from './ICornerExtractor';
export { CornerExtractor } from './CornerExtractor';

// 连通块检测
export { 
  findConnectedComponents, filterNearestComponent, isGoConnected,
  convexHull, pointInPolygon, shouldFallback,
} from './ComponentDetector';
export type { Point, ConnectedComponent } from './ComponentDetector';

// 方向归一化
export { convertToRudl, convertToRuld, areEquivalent, deduplicateJoseki } from './DirectionNormalizer';
export type { Corner } from './DirectionNormalizer';

// 定式加载器
export type { IJosekiLoader } from './IJosekiLoader';

// 定式 Trie
export type { IJosekiTrieNode, IJosekiTrie, IWinrateStats, ISubtreeRef } from './JosekiTrie';
export { deserializeTrie } from './JosekiTrie';

// 定式匹配器
export type {
  IJosekiMatcher,
  IMatchResult,
  ICandidateStats,
  ICandidateMove,
} from './IJosekiMatcher';
export { JosekiMatcher } from './JosekiMatcher';
export type { MatchResult, JosekiEndpoint } from './JosekiMatcher';

// 定式导出
export { exportTree, exportTreeWithCandidates, exportTreeFromEndpoints } from './JosekiExporter';

// 定式构建器
export { JosekiBuilder } from './JosekiBuilder';
export type { JosekiItem, BuildConfig, SequenceData, TempLine } from './JosekiBuilder';
export { HeapItem, MinHeap } from './JosekiHeap';

// 定式发现器
export { discover } from './JosekiDiscoverer';
export type { DiscoverOptions } from './JosekiDiscoverer';

// 定式探索器（状态化交互对象）
export { JosekiExplorer } from './JosekiExplorer';
export type { IExploreStats } from './JosekiExplorer';

// 统一类型导出
export * from './types';
