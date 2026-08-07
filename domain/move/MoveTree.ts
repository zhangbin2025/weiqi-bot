import type { MoveOrPass } from './IMove';
import type { IMoveTree, IMoveTreeNode } from './IMoveTree';

/**
 * 着法树实现
 * 支持分支和变着的管理
 * @ai-example
 * const tree = new MoveTree();
 * tree.addMove([], { x: 3, y: 3, color: 'black', number: 1 });
 */
export class MoveTree implements IMoveTree {
  readonly root: IMoveTreeNode;

  constructor() {
    this.root = { move: null, children: [] };
  }

  /**
   * 添加着法到指定路径
   */
  addMove(path: readonly number[], move: MoveOrPass): number[] {
    const parent = this.getNode(path);
    if (!parent) return [];
    const newNode: IMoveTreeNode = { move, children: [] };
    parent.children.push(newNode);
    return [...path, parent.children.length - 1];
  }

  /**
   * 获取指定路径的节点
   */
  getNode(path: readonly number[]): IMoveTreeNode | null {
    let node: IMoveTreeNode = this.root;
    for (const index of path) {
      if (index < 0 || index >= node.children.length) {
        return null;
      }
      node = node.children[index]!;
    }
    return node;
  }

  /**
   * 获取主分支着法序列
   */
  getMainBranch(): MoveOrPass[] {
    const moves: MoveOrPass[] = [];
    let node: IMoveTreeNode = this.root;
    while (node.children.length > 0) {
      const child = node.children[0];
      if (child && child.move) {
        moves.push(child.move);
      }
      node = child ?? node;
    }
    return moves;
  }

  /**
   * 获取指定路径的着法序列
   */
  getMovesToPath(path: readonly number[]): MoveOrPass[] {
    const moves: MoveOrPass[] = [];
    let node: IMoveTreeNode = this.root;
    for (const index of path) {
      if (index < 0 || index >= node.children.length) {
        break;
      }
      const child = node.children[index];
      if (child && child.move) {
        moves.push(child.move);
      }
      node = child!;
    }
    return moves;
  }

  /**
   * 克隆着法树
   */
  clone(): MoveTree {
    const newTree = new MoveTree();
    (newTree.root as { children: IMoveTreeNode[] }).children = this.cloneNodes(this.root.children);
    return newTree;
  }

  private cloneNodes(nodes: IMoveTreeNode[]): IMoveTreeNode[] {
    return nodes.map((node) => ({
      move: node.move,
      children: this.cloneNodes(node.children),
      comment: node.comment,
    }));
  }
}