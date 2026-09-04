/**
 * 角定式提取器
 * 对应 Python: weiqi-joseki/src/extraction/component_detector.py (extract_corner_moves 等)
 *
 * 功能：四角定式提取，多路回退(13→11→9路)，脱先标记
 */

import type { RawMove } from "./ICornerExtractor";
import type { ICornerSequence, IFourCornersResult, ICornerMove } from "./ICornerSequence";
import type { CornerKey, ICornerRange } from "../coordinate";
import type { IStone, PlayerColor } from "../primitives";
import { getCornerRanges } from "../coordinate";
import { isGoConnected, shouldFallback, type Point } from "./ComponentDetector";

interface MoveWithPos {
  color: "B" | "W";
  coord: string;
  x: number;
  y: number;
}

interface ExtractionResult {
  moves: Array<["B" | "W", string]>;
  core: Set<string>;
  discarded: Set<string>;
}

/** 预置子输入类型 */
interface HandicapStone {
  x: number;
  y: number;
  color: string;
}

/**
 * 角定式提取器
 * 实现多路回退策略：13路 → 11路 → 9路
 */
export class CornerExtractor {
  /**
   * 提取四个角的定式
   */
  extractFourCorners(
    moves: readonly RawMove[],
    firstN: number = 80,
    handicapStones: readonly HandicapStone[] = []
  ): IFourCornersResult {
    const limited = moves.slice(0, firstN);
    const result: IFourCornersResult = {};
    const corners: CornerKey[] = ["tl", "tr", "bl", "br"];
    for (const ck of corners) {
      const handicap = this.filterHandicap(handicapStones, ck);
      const seq = this.extractCorner(limited, ck, handicap);
      if (seq) (result as Record<string, ICornerSequence>)[ck] = seq;
    }
    return result;
  }

  /**
   * 提取单个角的定式（含多路回退 + 脱先标记）
   */
  extractCorner(
    moves: readonly RawMove[],
    cornerKey: string,
    handicapStones: readonly HandicapStone[] = []
  ): ICornerSequence | null {
    const ck = cornerKey as CornerKey;
    const ranges13 = getCornerRanges(13);
    const range = ranges13[ck];
    if (!range) return null;

    const cornerHandicap = handicapStones.filter(
      (s) => s.x >= range.colMin && s.x <= range.colMax && s.y >= range.rowMin && s.y <= range.rowMax
    );

    // 13路提取
    const result13 = this.extractNlu(moves, range, cornerHandicap);
    if (!shouldFallback(result13.core, result13.discarded)) {
      return this.toSequence(ck, result13.moves, cornerHandicap);
    }

    // 回退到11路
    const ranges11 = getCornerRanges(11);
    const result11 = this.extractNlu(moves, ranges11[ck]!, cornerHandicap);
    if (!shouldFallback(result11.core, result11.discarded)) {
      return this.toSequence(ck, result11.moves, cornerHandicap);
    }

    // 最终回退到9路
    const ranges9 = getCornerRanges(9);
    const result9 = this.extract9lu(moves, ranges9[ck]!, cornerHandicap);
    return this.toSequence(ck, result9, cornerHandicap);
  }

  /** 过滤属于指定角的预置子 */
  private filterHandicap(
    stones: readonly HandicapStone[],
    ck: CornerKey
  ): HandicapStone[] {
    const range = getCornerRanges(13)[ck]!;
    return stones.filter(
      (s) => s.x >= range.colMin && s.x <= range.colMax && s.y >= range.rowMin && s.y <= range.rowMax
    );
  }

  /** N路提取（含时序连通性分析） */
  private extractNlu(
    moves: readonly RawMove[],
    range: ICornerRange,
    handicap: HandicapStone[]
  ): ExtractionResult {
    const cornerMoves = this.filterMovesInCorner(moves, range);
    if (cornerMoves.length === 0 && handicap.length === 0)
      return { moves: [], core: new Set(), discarded: new Set() };

    const allPositions = new Set(cornerMoves.map((m) => `${m.x},${m.y}`));
    const initialPos: Point[] = handicap.map((s) => [s.x, s.y]);
    const { core, discarded } = this.temporalAnalysis(allPositions, cornerMoves, initialPos);

    const result = this.buildResult(cornerMoves, core, handicap);
    return { moves: result, core, discarded };
  }

  /** 9路提取（最终回退，只做时序过滤） */
  private extract9lu(
    moves: readonly RawMove[],
    range: ICornerRange,
    handicap: HandicapStone[]
  ): Array<["B" | "W", string]> {
    const cornerMoves = this.filterMovesInCorner(moves, range);
    const core = new Set<string>();
    const active = new Set<string>();

    for (const stone of handicap) {
      const pos = `${stone.x},${stone.y}`;
      active.add(pos);
      core.add(pos);
    }

    for (const move of cornerMoves) {
      const posStr = `${move.x},${move.y}`;
      if (active.size === 0) {
        active.add(posStr);
        core.add(posStr);
      } else {
        let connected = false;
        for (const ap of active) {
          const parts = ap.split(",");
          if (isGoConnected([move.x, move.y], [Number(parts[0]), Number(parts[1])])) {
            connected = true;
            break;
          }
        }
        if (connected) {
          active.add(posStr);
          core.add(posStr);
        }
      }
    }

    return this.buildResult(cornerMoves, core, handicap);
  }

  /** 时序连通性分析 */
  private temporalAnalysis(
    positions: Set<string>,
    moves: MoveWithPos[],
    initialPos: Point[]
  ): { core: Set<string>; discarded: Set<string> } {
    const core = new Set<string>();
    const discarded = new Set<string>();
    const active = new Set<string>();

    for (const [x, y] of initialPos) {
      const pos = `${x},${y}`;
      active.add(pos);
      core.add(pos);
    }

    for (const move of moves) {
      const posStr = `${move.x},${move.y}`;
      if (!positions.has(posStr)) continue;
      if (active.size === 0) {
        active.add(posStr);
        core.add(posStr);
      } else {
        let connected = false;
        for (const ap of active) {
          const parts = ap.split(",");
          if (isGoConnected([move.x, move.y], [Number(parts[0]), Number(parts[1])])) {
            connected = true;
            break;
          }
        }
        if (connected) {
          active.add(posStr);
          core.add(posStr);
        } else {
          discarded.add(posStr);
        }
      }
    }
    return { core, discarded };
  }

  /** 过滤指定角范围内的着法 */
  private filterMovesInCorner(moves: readonly RawMove[], range: ICornerRange): MoveWithPos[] {
    const result: MoveWithPos[] = [];
    for (const [color, coord] of moves) {
      if (!coord || coord === "tt" || coord.length !== 2) continue;
      const x = coord.charCodeAt(0) - 97;
      const y = coord.charCodeAt(1) - 97;
      if (x >= range.colMin && x <= range.colMax && y >= range.rowMin && y <= range.rowMax) {
        result.push({ color, coord, x, y });
      }
    }
    return result;
  }

  /** 构建结果着法序列（含脱先 tt 标记） */
  private buildResult(
    cornerMoves: MoveWithPos[],
    core: Set<string>,
    handicap: HandicapStone[]
  ): Array<["B" | "W", string]> {
    const result: Array<["B" | "W", string]> = [];
    let lastColor: string | null = null;

    for (const stone of handicap) {
      const coord = String.fromCharCode(97 + stone.x) + String.fromCharCode(97 + stone.y);
      if (lastColor === "B") result.push(["W", "tt"]);
      result.push([stone.color as "B" | "W", coord]);
      lastColor = stone.color;
    }

    for (const move of cornerMoves) {
      const posStr = `${move.x},${move.y}`;
      if (!core.has(posStr)) continue;
      if (lastColor === move.color) {
        result.push([move.color === "B" ? "W" : "B", "tt"]);
      }
      result.push([move.color, move.coord]);
      lastColor = move.color;
    }
    return result;
  }

  /** 转换为 ICornerSequence */
  private toSequence(
    ck: CornerKey,
    moves: Array<["B" | "W", string]>,
    handicap: HandicapStone[]
  ): ICornerSequence | null {
    if (moves.length === 0) return null;
    const cornerMoves: ICornerMove[] = moves.map(([color, coord]) => ({
      color,
      coord,
      isPass: coord === "tt",
    }));
    const stones: IStone[] = handicap.map((s) => ({
      x: s.x,
      y: s.y,
      color: (s.color === "B" ? "black" : "white") as PlayerColor,
    }));
    return {
      cornerKey: ck,
      moves: cornerMoves,
      handicapStones: stones,
    };
  }
}
