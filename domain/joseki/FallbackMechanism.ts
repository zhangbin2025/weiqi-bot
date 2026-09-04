/**
 * 多路 Fallback 机制 - 完整版
 */

export type Point = [number, number];

export function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) return points;
  
  const sorted = Array.from(new Set(points.map(p => `${p[0]},${p[1]}`)))
    .map(s => { const parts = s.split(','); return [Number(parts[0]), Number(parts[1])] as Point; })
    .sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);
  
  if (sorted.length <= 2) return sorted;
  
  const cross = (o: Point, a: Point, b: Point): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length === 0) return false;
  if (polygon.length === 1) return point[0] === polygon[0]![0] && point[1] === polygon[0]![1];
  
  const [x, y] = point;
  
  if (polygon.length === 2) {
    const [x1, y1] = polygon[0]!;
    const [x2, y2] = polygon[1]!;
    const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
    if (cross !== 0) return false;
    const dot = (x - x1) * (x - x2) + (y - y1) * (y - y2);
    return dot <= 0;
  }
  
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % n]!;
    
    const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
    if (cross === 0 && Math.min(x1, x2) <= x && x <= Math.max(x1, x2) && Math.min(y1, y2) <= y && y <= Math.max(y1, y2)) {
      return true;
    }
    
    if ((y1 > y) !== (y2 > y)) {
      const intersectX = x1 + (y - y1) * (x2 - x1) / (y2 - y1);
      if (x <= intersectX) inside = !inside;
    }
  }
  
  return inside;
}

export function isGoConnected(p1: Point, p2: Point): boolean {
  const dx = Math.abs(p1[0] - p2[0]);
  const dy = Math.abs(p1[1] - p2[1]);
  return dx <= 4 && dy <= 4 && dx + dy <= 5;
}

export function temporalConnectivityAnalysis(
  positions: Set<string>,
  moves: Array<[string, number, number]>,
  maxDistance: number = 4,
  initialPositions: Point[] = []
): { core: Set<string>; discarded: Set<string> } {
  const core = new Set<string>();
  const discarded = new Set<string>();
  const active = new Set<string>();
  
  for (const [x, y] of initialPositions) {
    const posStr = `${x},${y}`;
    active.add(posStr);
    core.add(posStr);
  }
  
  for (const [color, col, row] of moves) {
    const posStr = `${col},${row}`;
    if (!positions.has(posStr)) continue;
    
    if (active.size === 0) {
      active.add(posStr);
      core.add(posStr);
    } else {
      let isConnected = false;
      for (const activePos of active) {
        const parts = activePos.split(',');
        const ax = Number(parts[0]);
        const ay = Number(parts[1]);
        if (isGoConnected([col, row], [ax, ay])) {
          isConnected = true;
          break;
        }
      }
      
      if (isConnected) {
        active.add(posStr);
        core.add(posStr);
      } else {
        discarded.add(posStr);
      }
    }
  }
  
  return { core, discarded };
}

export function shouldFallback(corePositions: Set<string>, discardedPositions: Set<string>): boolean {
  if (discardedPositions.size === 0) return false;
  if (corePositions.size === 0) return false;
  
  const corePoints: Point[] = [];
  for (const pos of corePositions) {
    const parts = pos.split(',');
    corePoints.push([Number(parts[0]), Number(parts[1])]);
  }
  
  const hull = convexHull(corePoints);
  if (hull.length < 3) return false;
  
  for (const discPos of discardedPositions) {
    const parts = discPos.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (pointInPolygon([x, y], hull)) return true;
  }
  
  return false;
}

export interface ExtractionResult {
  moves: Array<[string, string]>;
  core: Set<string>;
  discarded: Set<string>;
}

export function extractCornerMovesWithFallback(
  moves: Array<[string, string]>,
  corner: 'tr' | 'tl' | 'br' | 'bl',
  handicapStones: Array<{ x: number; y: number; color: string }> = []
): Array<[string, string]> {
  const configs = {
    tr: {
      lu13: { colRange: [6, 18] as [number, number], rowRange: [0, 12] as [number, number] },
      lu11: { colRange: [8, 18] as [number, number], rowRange: [0, 10] as [number, number] },
      lu9: { colRange: [10, 18] as [number, number], rowRange: [0, 8] as [number, number] },
    },
    tl: {
      lu13: { colRange: [0, 12] as [number, number], rowRange: [0, 12] as [number, number] },
      lu11: { colRange: [0, 10] as [number, number], rowRange: [0, 10] as [number, number] },
      lu9: { colRange: [0, 8] as [number, number], rowRange: [0, 8] as [number, number] },
    },
    br: {
      lu13: { colRange: [6, 18] as [number, number], rowRange: [6, 18] as [number, number] },
      lu11: { colRange: [8, 18] as [number, number], rowRange: [8, 18] as [number, number] },
      lu9: { colRange: [10, 18] as [number, number], rowRange: [10, 18] as [number, number] },
    },
    bl: {
      lu13: { colRange: [0, 12] as [number, number], rowRange: [6, 18] as [number, number] },
      lu11: { colRange: [0, 10] as [number, number], rowRange: [8, 18] as [number, number] },
      lu9: { colRange: [0, 8] as [number, number], rowRange: [10, 18] as [number, number] },
    },
  };
  
  const config = configs[corner];
  const result13 = extractNlu(moves, corner, config.lu13, handicapStones);
  if (!shouldFallback(result13.core, result13.discarded)) return result13.moves;
  
  const result11 = extractNlu(moves, corner, config.lu11, handicapStones);
  if (!shouldFallback(result11.core, result11.discarded)) return result11.moves;
  
  return extract9lu(moves, corner, config.lu9, handicapStones);
}

function extractNlu(
  moves: Array<[string, string]>,
  corner: string,
  range: { colRange: [number, number]; rowRange: [number, number] },
  handicapStones: Array<{ x: number; y: number; color: string }>
): ExtractionResult {
  const [colMin, colMax] = range.colRange;
  const [rowMin, rowMax] = range.rowRange;
  
  const cornerHandicap = handicapStones.filter(s => colMin <= s.x && s.x <= colMax && rowMin <= s.y && s.y <= rowMax);
  
  const cornerMoves: Array<[string, number, number]> = [];
  for (const [color, coord] of moves) {
    if (coord === 'tt' || coord.length !== 2) continue;
    const col = coord.charCodeAt(0) - 97;
    const row = coord.charCodeAt(1) - 97;
    if (colMin <= col && col <= colMax && rowMin <= row && row <= rowMax) {
      cornerMoves.push([color, col, row]);
    }
  }
  
  const allPositions = new Set<string>();
  for (const [_, col, row] of cornerMoves) allPositions.add(`${col},${row}`);
  
  const initialPos = cornerHandicap.map(s => [s.x, s.y] as Point);
  const { core, discarded } = temporalConnectivityAnalysis(allPositions, cornerMoves, 4, initialPos);
  
  const result: Array<[string, string]> = [];
  let lastColor: string | null = null;
  
  for (const stone of cornerHandicap) {
    const coord = String.fromCharCode(97 + stone.x) + String.fromCharCode(97 + stone.y);
    if (lastColor === 'B') result.push(['W', 'tt']);
    result.push([stone.color, coord]);
    lastColor = stone.color;
  }
  
  for (const [color, col, row] of cornerMoves) {
    const posStr = `${col},${row}`;
    if (core.has(posStr)) {
      if (lastColor === color) result.push([color === 'B' ? 'W' : 'B', 'tt']);
      result.push([color, String.fromCharCode(97 + col) + String.fromCharCode(97 + row)]);
      lastColor = color;
    }
  }
  
  return { moves: result, core, discarded };
}

function extract9lu(
  moves: Array<[string, string]>,
  corner: string,
  range: { colRange: [number, number]; rowRange: [number, number] },
  handicapStones: Array<{ x: number; y: number; color: string }>
): Array<[string, string]> {
  const [colMin, colMax] = range.colRange;
  const [rowMin, rowMax] = range.rowRange;
  
  const cornerHandicap = handicapStones.filter(s => colMin <= s.x && s.x <= colMax && rowMin <= s.y && s.y <= rowMax);
  
  const cornerMoves: Array<[string, number, number]> = [];
  for (const [color, coord] of moves) {
    if (coord === 'tt' || coord.length !== 2) continue;
    const col = coord.charCodeAt(0) - 97;
    const row = coord.charCodeAt(1) - 97;
    if (colMin <= col && col <= colMax && rowMin <= row && row <= rowMax) {
      cornerMoves.push([color, col, row]);
    }
  }
  
  const core = new Set<string>();
  const active = new Set<string>();
  
  for (const stone of cornerHandicap) {
    const pos = `${stone.x},${stone.y}`;
    active.add(pos);
    core.add(pos);
  }
  
  for (const [color, col, row] of cornerMoves) {
    const posStr = `${col},${row}`;
    if (active.size === 0) {
      active.add(posStr);
      core.add(posStr);
    } else {
      let isConnected = false;
      for (const activePos of active) {
        const parts = activePos.split(',');
        const ax = Number(parts[0]);
        const ay = Number(parts[1]);
        if (isGoConnected([col, row], [ax, ay])) {
          isConnected = true;
          break;
        }
      }
      if (isConnected) {
        active.add(posStr);
        core.add(posStr);
      }
    }
  }
  
  const result: Array<[string, string]> = [];
  let lastColor: string | null = null;
  
  for (const stone of cornerHandicap) {
    const coord = String.fromCharCode(97 + stone.x) + String.fromCharCode(97 + stone.y);
    if (lastColor === 'B') result.push(['W', 'tt']);
    result.push([stone.color, coord]);
    lastColor = stone.color;
  }
  
  for (const [color, col, row] of cornerMoves) {
    const posStr = `${col},${row}`;
    if (core.has(posStr)) {
      if (lastColor === color) result.push([color === 'B' ? 'W' : 'B', 'tt']);
      result.push([color, String.fromCharCode(97 + col) + String.fromCharCode(97 + row)]);
      lastColor = color;
    }
  }
  
  return result;
}
