/**
 * 定式库加载器接口
 * @description Domain 层接口，定义定式库加载能力
 */

import type { IJosekiTrie, IJosekiTrieNode } from './JosekiTrie';

/**
 * 定式库加载器接口
 */
export interface IJosekiLoader {
  /**
   * 加载定式索引
   * @returns Trie 树
   */
  loadTrie(onProgress?: (percent: number, status: string, detail?: string) => void): Promise<IJosekiTrie>;

  /**
   * 加载子树并合并到节点
   * @param node - 需要加载子树的节点（有 subtree 字段）
   */
  loadAndMergeSubtree(node: IJosekiTrieNode, onProgress?: (percent: number, status: string) => void): Promise<void>;

  /**
   * 获取数据路径
   */
  getDataUrl?(): string | Promise<string>;
}