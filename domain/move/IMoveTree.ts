import type { MoveOrPass } from './IMove';

/**
 * 着法树节点接口（用于表示棋谱分支）
 * @ai-example
 * const node: IMoveTreeNode = {
 *   move: { x: 3, y: 3, color: 'black', number: 1 },
 *   children: [],
 *   comment: '小目'
 * };
 */
export interface IMoveTreeNode {
  /** 当前着法（根节点可能为空） */
  readonly move: MoveOrPass | null;
  /** 子节点列表 */
  readonly children: IMoveTreeNode[];
  /** 注释 */
  readonly comment?: string | undefined;
}

/**
 * 着法树接口
 * @ai-example
 * const tree: IMoveTree = { root: { move: null, children: [] } };
 */
export interface IMoveTree {
  /** 根节点 */
  readonly root: IMoveTreeNode;
  /**
   * 添加着法到指定路径
   * @param path - 节点路径（索引数组）
   * @param move - 着法
   * @returns 新路径
   */
  addMove(path: readonly number[], move: MoveOrPass): number[];
  /**
   * 获取指定路径的节点
   * @param path - 节点路径
   * @returns 节点或 null
   */
  getNode(path: readonly number[]): IMoveTreeNode | null;
  /**
   * 获取主分支着法序列
   * @returns 着法序列
   */
  getMainBranch(): MoveOrPass[];
}