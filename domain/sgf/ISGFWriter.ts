/**
 * SGF 写入器接口
 * @module domain/sgf/ISGFWriter
 */

import type { MoveOrPass } from '../move';
import type { ISGFGameInfo } from './types';
import type { ISGFNode, SGFProperties } from './types';

/**
 * SGF 写入器接口
 * @ai-example
 * const writer: ISGFWriter = { write: (moves, info) => '(;SZ[19]...)' };
 */
export interface ISGFWriter {
  /**
   * 写入 SGF 文本（线性着法）
   * @param moves - 着法序列
   * @param info - 对局信息
   * @returns SGF 文本
   */
  write(moves: readonly MoveOrPass[], info?: Partial<ISGFGameInfo>): string;

  /**
   * 写入 SGF 文本（树状结构，保留分支）
   * @param node - SGF 节点树
   * @returns SGF 文本
   */
  writeTree(node: ISGFNode): string;
}

/**
 * SGF 写入配置接口
 */
export interface ISGFWriteOptions {
  /** 是否包含注释 */
  readonly includeComments?: boolean;
  /** 换行符 */
  readonly newline?: string;
}

/**
 * 属性序列化选项
 */
export interface ISGFPropertySerializeOptions {
  /** 属性白名单（仅保留这些属性），null 表示全部保留 */
  readonly whitelist?: Set<string> | null;
  /** 属性黑名单（排除这些属性），null 表示不排除 */
  readonly blacklist?: Set<string> | null;
}
