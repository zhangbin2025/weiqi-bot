/**
 * 定式匹配器实现
 * @description 基于 Trie 的定式匹配算法，支持动态加载子树
 */

import type { RawMove } from './ICornerExtractor';
import type { IJosekiTrie, IJosekiTrieNode, IWinrateStats } from './JosekiTrie';
import type { IJosekiLoader } from './IJosekiLoader';

/** 匹配结果 */
export interface MatchResult {
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
  /** 频率 */
  freq: number;
  /** 概率 */
  prob: number;
  /** 定式终点列表 */
  endpoints?: JosekiEndpoint[];
}

/** 定式终点 */
export interface JosekiEndpoint {
  path: string[];
  freq: number;
  prob: number;
  /** 手数 */
  moves?: number;
  /** 胜率统计 */
  winrate?: IWinrateStats;
}

/**
 * 定式匹配器
 * 支持按需加载子树，避免一次性加载整棵树
 */
export class JosekiMatcher {
  constructor(private readonly loader: IJosekiLoader) {}

  /**
   * 匹配单个着法串（异步，支持动态加载）
   */
  async match(moves: readonly RawMove[], trie: IJosekiTrie): Promise<MatchResult> {
    let node = trie.root;
    const matchedPath: string[] = [];
    let depth = 0;
    let lastMatchIndex = -1;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (!move) continue;

      const [_, coord] = move;
      // 注意：不要跳过 pass (tt)，定式库中可能包含 tt

      // 检查当前节点是否需要加载子树
      if (node.subtree && !node.children) {
        await this.loader.loadAndMergeSubtree(node);
      }

      // 检查是否有子节点
      if (!node.children) {
        break;
      }

      // 查找下一个节点
      const nextNode = node.children[coord];
      if (nextNode) {
        node = nextNode;
        matchedPath.push(coord);
        depth++;
        lastMatchIndex = i;
      } else {
        // 如果找不到匹配的着法
        // 如果是 pass (tt)，跳过它，继续匹配下一个着法
        if (coord === 'tt') {
          continue; // 跳过 pass
        }
        break; // 否则停止匹配
      }
    }

    const remainingMoves = moves.slice(lastMatchIndex + 1);
    const isComplete = remainingMoves.length === 0 && matchedPath.length > 0;

    return {
      matchedPath,
      matchedNode: depth > 0 ? node : null,
      isComplete,
      remainingMoves,
      depth,
      freq: node.freq ?? 0,
      prob: node.prob ?? 0,
    };
  }

  /**
   * 查找候选着法
   */
  findNextMoves(currentNode: IJosekiTrieNode): ICandidateMove[] {
    const candidates: ICandidateMove[] = [];
    const children = currentNode.children;

    if (!children) return candidates;

    for (const [coord, child] of Object.entries(children)) {
      candidates.push({
        coord,
        stats: {
          winrateDelta: child.winrate?.delta ?? 0,
          frequency: child.freq ?? 0,
          probability: child.prob ?? 0,
          heat: child.heat ?? 0,
        },
        color: child.color,
      });
    }

    return candidates.sort((a, b) => b.stats.probability - a.stats.probability);
  }

  /**
   * 查找最佳候选
   */
  findBestMove(currentNode: IJosekiTrieNode): ICandidateMove | null {
    const candidates = this.findNextMoves(currentNode);
    return candidates[0] ?? null;
  }

  /**
   * 收集包含指定前缀的所有定式终点
   * @param prefix - 前缀着法串
   * @param trie - Trie 树根节点
   * @returns 定式终点列表 [{path, freq, prob, ids}, ...]
   */
  async collectJosekiEndpoints(prefix: string[], trie: IJosekiTrie): Promise<JosekiEndpoint[]> {
    const results: JosekiEndpoint[] = [];

    // 定位前缀节点
    let startNode = trie.root;
    for (const move of prefix) {
      // 加载子树（如果需要）
      if (startNode.subtree && !startNode.children) {
        await this.loader.loadAndMergeSubtree(startNode);
      }
      if (!startNode.children || !startNode.children[move]) {
        return results; // 前缀不存在
      }
      startNode = startNode.children[move];
    }

    // 从前缀节点开始深度遍历，收集所有定式终点
    const traverse = async (node: IJosekiTrieNode, currentPath: string[]) => {
      // 加载子树（如果需要）
      if (node.subtree && !node.children) {
        await this.loader.loadAndMergeSubtree(node);
      }

      // 如果节点有 freq > 0，说明是定式终点
      if (node.freq && node.freq > 0) {
        results.push({
          path: [...currentPath],
          freq: node.freq,
          prob: node.prob ?? 0,
          ...(node.moves !== undefined && { moves: node.moves }),
          ...(node.winrate && { winrate: node.winrate }),
        });
      }

      // 递归遍历子节点
      if (node.children) {
        for (const [move, childNode] of Object.entries(node.children)) {
          await traverse(childNode, [...currentPath, move]);
        }
      }
    };

    await traverse(startNode, [...prefix]);
    return results;
  }
}

/** 候选着法统计 */
export interface ICandidateStats {
  winrateDelta: number;
  frequency: number;
  probability: number;
  heat: number;
}

/** 候选着法 */
export interface ICandidateMove {
  coord: string;
  stats: ICandidateStats;
  color?: 'black' | 'white' | undefined;
}
