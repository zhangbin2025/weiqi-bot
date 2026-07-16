/**
 * 定式匹配器接口
 * @description 定义定式匹配的接口规范
 */

import type { RawMove } from './ICornerExtractor';
import type { IJosekiTrieNode, IJosekiTrie } from './JosekiTrie';
import type { MatchResult } from './JosekiMatcher';

/**
 * 候选着法统计
 */
export interface ICandidateStats {
  /** 胜率变化 */
  winrateDelta: number;
  /** 频率 */
  frequency: number;
  /** 概率 */
  probability: number;
  /** 热度 */
  heat: number;
}

/**
 * 候选着法
 */
export interface ICandidateMove {
  /** 着法坐标 */
  coord: string;
  /** 统计数据 */
  stats: ICandidateStats;
  /** 颜色 */
  color?: 'black' | 'white' | undefined;
}

/**
 * 匹配结果（旧版兼容）
 */
export interface IMatchResult {
  /** 匹配的坐标路径 */
  matchedPath: string[];
  /** 匹配的节点 */
  matchedNode: IJosekiTrieNode | null;
  /** 是否完整匹配 */
  isComplete: boolean;
  /** 剩余着法 */
  remainingMoves: RawMove[];
  /** 匹配深度 */
  depth: number;
}

/**
 * 定式匹配器接口
 */
export interface IJosekiMatcher {
  /**
   * 匹配定式（异步，支持动态加载）
   */
  match(moves: readonly RawMove[], trie: IJosekiTrie): Promise<MatchResult>;

  /**
   * 查找候选着法
   */
  findNextMoves(currentNode: IJosekiTrieNode): ICandidateMove[];

  /**
   * 查找最佳候选
   */
  findBestMove?(currentNode: IJosekiTrieNode): ICandidateMove | null;
}
