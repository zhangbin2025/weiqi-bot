import type { SGFColor, IStone } from '../primitives';
import type { CornerKey } from '../coordinate';

/**
 * 角定式着法接口
 * @ai-example
 * const move: ICornerMove = { color: 'B', coord: 'dd', isPass: false };
 */
export interface ICornerMove {
  /** 颜色 (SGF 格式) */
  readonly color: SGFColor;
  /** SGF 坐标 */
  readonly coord: string;
  /** 是否为停一手（脱先） */
  readonly isPass: boolean;
}

/**
 * 角定式序列接口
 * @ai-example
 * const seq: ICornerSequence = {
 *   cornerKey: 'tl',
 *   moves: [{ color: 'B', coord: 'dd', isPass: false }],
 *   handicapStones: []
 * };
 */
export interface ICornerSequence {
  /** 角标识 */
  readonly cornerKey: CornerKey;
  /** 着法序列 */
  readonly moves: readonly ICornerMove[];
  /** 预置子 */
  readonly handicapStones: readonly IStone[];
}

/**
 * 四角定式提取结果接口
 * @ai-example
 * const result: IFourCornersResult = {
 *   tl: [...],
 *   tr: [...],
 *   bl: [...],
 *   br: [...]
 * };
 */
export interface IFourCornersResult {
  /** 左上角定式 */
  readonly tl?: ICornerSequence;
  /** 右上角定式 */
  readonly tr?: ICornerSequence;
  /** 左下角定式 */
  readonly bl?: ICornerSequence;
  /** 右下角定式 */
  readonly br?: ICornerSequence;
}