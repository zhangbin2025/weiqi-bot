import type { MoveOrPass } from '../move';
import type { ISGFGameInfo } from './types';

/**
 * SGF 写入器接口
 * @ai-example
 * const writer: ISGFWriter = { write: (moves, info) => '(;SZ[19]...)' };
 */
export interface ISGFWriter {
  /**
   * 写入 SGF 文本
   * @param moves - 着法序列
   * @param info - 对局信息
   * @returns SGF 文本
   */
  write(moves: readonly MoveOrPass[], info?: Partial<ISGFGameInfo>): string;
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