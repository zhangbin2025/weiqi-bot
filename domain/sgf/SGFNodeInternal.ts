/**
 * SGF 内部节点类
 * @module domain/sgf/SGFNodeInternal
 */

import type { SGFProperties } from './types';

/**
 * 内部节点类（解析过程中使用）
 */
export class SGFNodeInternal {
  /** 属性字典 */
  properties: SGFProperties = {};
  /** 是否根节点 */
  isRoot: boolean = false;
  /** 手数（根节点为0） */
  moveNumber: number = 0;
  /** 着法颜色（B/W），非着法节点为 null */
  color: 'B' | 'W' | null = null;
  /** 着法坐标（如 'pd'），非着法节点为 null */
  coord: string | null = null;
  /** 父节点 */
  parent: SGFNodeInternal | null = null;
  /** 子节点（分支） */
  children: SGFNodeInternal[] = [];
}