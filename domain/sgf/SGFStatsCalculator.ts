/**
 * SGF 统计信息计算
 * @module domain/sgf/SGFStatsCalculator
 */

import type { ISGFNode, ISGFStats } from './types';
import { SGFNodeInternal } from './SGFNodeInternal';

/**
 * 计算统计信息
 */
export function calcStats(tree: ISGFNode): ISGFStats {
  let totalNodes = 0;
  let moveNodes = 0;
  let maxDepth = 0;
  let branchCount = 0;

  const traverse = (node: ISGFNode): void => {
    totalNodes++;
    if (!node.isRoot) moveNodes++;
    maxDepth = Math.max(maxDepth, node.moveNumber);
    const children = node.children;
    if (children.length > 1) {
      branchCount += children.length - 1;
    }
    for (const child of children) {
      traverse(child);
    }
  };

  traverse(tree);

  return { totalNodes, moveNodes, maxDepth, branchCount };
}

/**
 * 内部节点转字典
 */
export function nodeToDict(node: SGFNodeInternal): ISGFNode {
  return {
    properties: node.properties,
    isRoot: node.isRoot,
    moveNumber: node.moveNumber,
    color: node.color,
    coord: node.coord,
    children: node.children.map((c) => nodeToDict(c)),
  };
}
