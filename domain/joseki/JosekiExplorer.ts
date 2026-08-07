/**
 * 定式探索器
 * @description 提供定式探索的交互式操作，支持动态加载
 */

import type { IJosekiTrie, IJosekiTrieNode } from './JosekiTrie';
import type { IJosekiLoader } from './IJosekiLoader';
import { JosekiMatcher, type ICandidateMove } from './JosekiMatcher';

/**
 * 探索统计
 */
export interface IExploreStats {
  movesCount: number;
  winrateDelta: number;
  frequency: number;
  probability: number;
  heat: number;
}

/**
 * 定式探索器
 */
export class JosekiExplorer {
  private currentNode: IJosekiTrieNode;
  private path: string[] = [];
  private matcher: JosekiMatcher;

  constructor(
    private readonly trie: IJosekiTrie,
    private readonly loader: IJosekiLoader
  ) {
    this.currentNode = trie.root;
    this.matcher = new JosekiMatcher(loader);
  }

  /**
   * 获取候选着法
   */
  getCandidateMoves(): ICandidateMove[] {
    return this.matcher.findNextMoves(this.currentNode);
  }

  /**
   * 落子（异步，可能触发动态加载）
   */
  async playMove(coord: string): Promise<boolean> {
    if (!coord) {
      return false;
    }

    // 检查是否需要加载子树
    if (this.currentNode.subtree && !this.currentNode.children) {
      await this.loader.loadAndMergeSubtree(this.currentNode);
    }

    const children = this.currentNode.children;
    if (!children) return false;

    const nextNode = children[coord];
    if (!nextNode) return false;

    this.path.push(coord);
    this.currentNode = nextNode;
    return true;
  }

  /**
   * 撤销
   */
  undo(): boolean {
    if (this.path.length === 0) {
      return false;
    }

    this.path.pop();
    this.currentNode = this.findNodeByPath(this.trie.root, this.path);
    return true;
  }

  /**
   * 重置到根节点
   */
  reset(): void {
    this.path = [];
    this.currentNode = this.trie.root;
  }

  /**
   * 获取当前统计
   */
  getCurrentStats(): IExploreStats {
    return {
      movesCount: this.path.length,
      winrateDelta: this.currentNode.winrate?.delta ?? 0,
      frequency: this.currentNode.freq ?? 0,
      probability: this.currentNode.prob ?? 0,
      heat: this.currentNode.heat ?? 0,
    };
  }

  /**
   * 获取当前路径
   */
  getCurrentPath(): string[] {
    return [...this.path];
  }

  /**
   * 获取当前节点
   */
  getCurrentNode(): IJosekiTrieNode {
    return this.currentNode;
  }

  /**
   * 检查路径是否完整匹配（到达叶子）
   */
  isComplete(): boolean {
    const children = this.currentNode.children;
    return !children || Object.keys(children).length === 0;
  }

  /**
   * 检查当前节点是否为定式（有 freq）
   */
  isJoseki(): boolean {
    return (this.currentNode.freq ?? 0) > 0;
  }

  /**
   * 根据路径查找节点
   */
  private findNodeByPath(
    node: IJosekiTrieNode,
    path: string[]
  ): IJosekiTrieNode {
    if (path.length === 0) {
      return node;
    }

    const first = path[0];
    if (!first) return node;

    const rest = path.slice(1);
    const children = node.children;
    if (!children) return node;

    const nextNode = children[first];
    if (!nextNode) return node;

    return this.findNodeByPath(nextNode, rest);
  }
}
