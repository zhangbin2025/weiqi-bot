import type { SGFColor, IStone } from '../primitives';
import type { ICornerSequence, IFourCornersResult } from './ICornerSequence';

/**
 * 原始着法格式（颜色 + SGF坐标）
 */
export type RawMove = [SGFColor, string];

/**
 * 角定式提取器接口
 * @ai-example
 * const extractor: ICornerExtractor = {
 *   extractFourCorners: (moves) => ({ tl: {...}, ... })
 * };
 */
export interface ICornerExtractor {
  /**
   * 提取四个角的定式
   * @param moves - 着法序列 [(color, coord), ...]
   * @param firstN - 只取前N手
   * @param handicapStones - 预置子
   * @returns 四角定式结果
   */
  extractFourCorners(
    moves: readonly RawMove[],
    firstN?: number,
    handicapStones?: readonly IStone[]
  ): IFourCornersResult;
  /**
   * 提取单个角的定式
   * @param moves - 着法序列
   * @param cornerKey - 角标识
   * @param handicapStones - 预置子
   * @returns 角定式序列
   */
  extractCorner(
    moves: readonly RawMove[],
    cornerKey: string,
    handicapStones?: readonly IStone[]
  ): ICornerSequence | null;
}