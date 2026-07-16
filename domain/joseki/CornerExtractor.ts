import type { SGFColor, IStone } from '../primitives';
import type { ICornerExtractor, RawMove } from './ICornerExtractor';
import type { ICornerSequence, IFourCornersResult, ICornerMove } from './ICornerSequence';
import type { CornerKey, ICornerRange } from '../coordinate';
import { getCornerRanges } from '../coordinate';

/**
 * 角定式提取器实现
 * 基于时序连通性的四角定式提取
 * @ai-example
 * const extractor = new CornerExtractor();
 * const moves: RawMove[] = [['B', 'dd'], ['W', 'pp'], ['B', 'pd']];
 * const result = extractor.extractFourCorners(moves);
 */
export class CornerExtractor implements ICornerExtractor {
  /**
   * 提取四个角的定式
   */
  extractFourCorners(
    moves: readonly RawMove[],
    firstN: number = 80,
    handicapStones: readonly IStone[] = []
  ): IFourCornersResult {
    const limitedMoves = moves.slice(0, firstN);
    const result: IFourCornersResult = {};
    const corners: CornerKey[] = ['tl', 'tr', 'bl', 'br'];
    for (const cornerKey of corners) {
      const handicap = this.filterHandicapForCorner(handicapStones, cornerKey);
      const sequence = this.extractCorner(limitedMoves, cornerKey, handicap);
      if (sequence) {
        (result as Record<string, ICornerSequence>)[cornerKey] = sequence;
      }
    }
    return result;
  }

  /**
   * 提取单个角的定式
   */
  extractCorner(
    moves: readonly RawMove[],
    cornerKey: string,
    handicapStones: readonly IStone[] = []
  ): ICornerSequence | null {
    const ranges = getCornerRanges(13);
    const range = ranges[cornerKey as CornerKey];
    if (!range) return null;
    // 收集该角范围内的着法
    const cornerMoves = this.filterMovesInCorner(moves, range);
    if (cornerMoves.length === 0 && handicapStones.length === 0) {
      return null;
    }
    // 时序连通性分析
    const coreMoves = this.findCoreMoves(cornerMoves, range, handicapStones);
    return {
      cornerKey: cornerKey as CornerKey,
      moves: coreMoves,
      handicapStones,
    };
  }

  /**
   * 过滤属于指定角的预置子
   */
  private filterHandicapForCorner(
    handicapStones: readonly IStone[],
    cornerKey: CornerKey
  ): IStone[] {
    const ranges = getCornerRanges(13);
    const range = ranges[cornerKey];
    return handicapStones.filter(
      (s) =>
        s.x >= range.colMin &&
        s.x <= range.colMax &&
        s.y >= range.rowMin &&
        s.y <= range.rowMax
    );
  }

  /**
   * 过滤指定角范围内的着法
   */
  private filterMovesInCorner(
    moves: readonly RawMove[],
    range: ICornerRange
  ): { color: SGFColor; coord: string; x: number; y: number }[] {
    const result: { color: SGFColor; coord: string; x: number; y: number }[] = [];
    for (const [color, coord] of moves) {
      if (!coord || coord === 'tt' || coord.length !== 2) continue;
      const x = coord.charCodeAt(0) - 97;
      const y = coord.charCodeAt(1) - 97;
      if (x >= range.colMin && x <= range.colMax && y >= range.rowMin && y <= range.rowMax) {
        result.push({ color, coord, x, y });
      }
    }
    return result;
  }

  /**
   * 基于时序连通性查找核心着法
   */
  private findCoreMoves(
    moves: { color: SGFColor; coord: string; x: number; y: number }[],
    _range: ICornerRange,
    handicapStones: readonly IStone[]
  ): ICornerMove[] {
    const coreMoves: ICornerMove[] = [];
    const activePositions = new Set<string>();
    // 先添加预置子作为初始位置
    for (const stone of handicapStones) {
      activePositions.add(`${stone.x},${stone.y}`);
    }
    // 时序遍历，保留连通的着法
    for (const move of moves) {
      const posKey = `${move.x},${move.y}`;
      if (activePositions.size === 0) {
        // 第一个着法
        activePositions.add(posKey);
        coreMoves.push({ color: move.color, coord: move.coord, isPass: false });
      } else {
        // 检查是否与活跃区域连通
        const isConnected = this.isConnectedToActive(move.x, move.y, activePositions);
        if (isConnected) {
          activePositions.add(posKey);
          coreMoves.push({ color: move.color, coord: move.coord, isPass: false });
        }
      }
    }
    return coreMoves;
  }

  /**
   * 检查位置是否与活跃区域连通
   * 围棋连通距离：max(|dx|, |dy|) <= 4 且 |dx| + |dy| <= 5
   */
  private isConnectedToActive(x: number, y: number, activePositions: Set<string>): boolean {
    for (const pos of activePositions) {
      const coords = pos.split(',').map(Number);
      const ax = coords[0];
      const ay = coords[1];
      if (ax === undefined || ay === undefined) continue;
      const dx = Math.abs(x - ax);
      const dy = Math.abs(y - ay);
      if (dx <= 4 && dy <= 4 && dx + dy <= 5) {
        return true;
      }
    }
    return false;
  }
}