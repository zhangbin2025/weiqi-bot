/**
 * 定式模块统一类型导出
 */

// 从现有模块重新导出
export type { ICornerMove, ICornerSequence, IFourCornersResult } from './ICornerSequence';
export type { ICornerExtractor, RawMove } from './ICornerExtractor';
export { CornerExtractor } from './CornerExtractor';

// Trie 相关类型
export type { IJosekiTrieNode, IJosekiTrie } from './JosekiTrie';
export { deserializeTrie } from './JosekiTrie';

// 匹配器相关类型
export type {
  IJosekiMatcher,
  IMatchResult,
  ICandidateStats,
  ICandidateMove,
} from './IJosekiMatcher';
export { JosekiMatcher } from './JosekiMatcher';