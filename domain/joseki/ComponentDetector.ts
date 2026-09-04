/**
 * 连通块检测器 + 几何工具
 * 对应 Python: weiqi-joseki/src/extraction/component_detector.py
 *
 * 功能：八连通查找、围棋连通距离合并、凸包计算、点在多边形内判断
 */

export type Point = [number, number];

/** 连通块 */
export class ConnectedComponent {
  private _positions: Set<string>;
  private _cornerOrigin: [number, number];

  constructor(positions: Set<string>, cornerOrigin: [number, number]) {
    this._positions = positions;
    this._cornerOrigin = cornerOrigin;
  }

  get size(): number { return this._positions.size; }
  getPositions(): Set<string> { return this._positions; }
  getCornerOrigin(): [number, number] { return this._cornerOrigin; }

  get distanceToCorner(): number {
    const [cx, cy] = this._cornerOrigin;
    let minDist = Infinity;
    for (const posStr of this._positions) {
      const parts = posStr.split(",");
      if (parts.length === 2) {
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (!isNaN(x) && !isNaN(y)) {
          const dist = Math.abs(x - cx) + Math.abs(y - cy);
          if (dist < minDist) minDist = dist;
        }
      }
    }
    return minDist === Infinity ? 0 : minDist;
  }
}

/** 八连通查找连通块 */
export function findConnectedComponents(
  positions: Point[],
  cornerOrigin: [number, number]
): ConnectedComponent[] {
  if (positions.length === 0) return [];
  const posSet = new Set(positions.map(([x, y]) => `${x},${y}`));
  const visited = new Set<string>();
  const components: ConnectedComponent[] = [];
  const dirs: Point[] = [
    [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
  ];

  for (const start of positions) {
    const key = `${start[0]},${start[1]}`;
    if (visited.has(key)) continue;
    const comp = new Set<string>();
    const queue: Point[] = [start];
    visited.add(key);
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      comp.add(`${x},${y}`);
      for (const [dx, dy] of dirs) {
        const nkey = `${x + dx},${y + dy}`;
        if (posSet.has(nkey) && !visited.has(nkey)) {
          visited.add(nkey);
          queue.push([x + dx, y + dy]);
        }
      }
    }
    components.push(new ConnectedComponent(comp, cornerOrigin));
  }
  return components.length > 1 ? mergeComponents(components) : components;
}

/** 围棋连通距离: max(|dx|,|dy|) <= 4 且 |dx|+|dy| <= 5 */
export function isGoConnected(p1: Point, p2: Point): boolean {
  const dx = Math.abs(p1[0] - p2[0]);
  const dy = Math.abs(p1[1] - p2[1]);
  return dx <= 4 && dy <= 4 && dx + dy <= 5;
}

function shouldMerge(c1: ConnectedComponent, c2: ConnectedComponent): boolean {
  for (const p1 of c1.getPositions()) {
    for (const p2 of c2.getPositions()) {
      const a = p1.split(",");
      const b = p2.split(",");
      if (a.length === 2 && b.length === 2) {
        if (isGoConnected([Number(a[0]), Number(a[1])], [Number(b[0]), Number(b[1])]))
          return true;
      }
    }
  }
  return false;
}

function mergeComponents(comps: ConnectedComponent[]): ConnectedComponent[] {
  const n = comps.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : ((parent[x] = find(parent[x]!)), parent[x]!);
  const union = (x: number, y: number) => {
    const px = find(x), py = find(y);
    if (px !== py) parent[px]! = py;
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (shouldMerge(comps[i]!, comps[j]!)) union(i, j);
  const groups = new Map<number, Set<string>>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, new Set());
    for (const p of comps[i]!.getPositions()) groups.get(r)!.add(p);
  }
  return Array.from(groups.values()).map(
    (s) => new ConnectedComponent(s, comps[0]!.getCornerOrigin())
  );
}

/** 保留离角最近的连通块 */
export function filterNearestComponent(components: ConnectedComponent[]): Set<string> {
  if (components.length === 0) return new Set();
  let nearest = components[0]!;
  for (let i = 1; i < components.length; i++)
    if (components[i]!.distanceToCorner < nearest.distanceToCorner)
      nearest = components[i]!;
  return nearest.getPositions();
}

/** 凸包计算（单调链算法） */
export function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) return points;
  const sorted = Array.from(new Set(points.map(p => `${p[0]},${p[1]}`)))
    .map(s => { const p = s.split(","); return [Number(p[0]), Number(p[1])] as Point; })
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

/** 点在多边形内（射线法，含边界） */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length === 0) return false;
  if (polygon.length === 1) return point[0] === polygon[0]![0] && point[1] === polygon[0]![1];
  const [x, y] = point;
  if (polygon.length === 2) {
    const [x1, y1] = polygon[0]!;
    const [x2, y2] = polygon[1]!;
    const cr = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
    if (cr !== 0) return false;
    const dot = (x - x1) * (x - x2) + (y - y1) * (y - y2);
    return dot <= 0;
  }
  let inside = false;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % n]!;
    const cr = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
    if (cr === 0 && Math.min(x1, x2) <= x && x <= Math.max(x1, x2) && Math.min(y1, y2) <= y && y <= Math.max(y1, y2))
      return true;
    if (y1 > y !== y2 > y) {
      const ix = x1 + ((y - y1) * (x2 - x1)) / (y2 - y1);
      if (x <= ix) inside = !inside;
    }
  }
  return inside;
}

/** 判断是否需要回退（被剔除的点在凸包内） */
export function shouldFallback(
  corePositions: Set<string>,
  discardedPositions: Set<string>
): boolean {
  if (discardedPositions.size === 0 || corePositions.size === 0) return false;
  const corePoints: Point[] = [];
  for (const pos of corePositions) {
    const parts = pos.split(",");
    corePoints.push([Number(parts[0]), Number(parts[1])]);
  }
  const hull = convexHull(corePoints);
  for (const discPos of discardedPositions) {
    const parts = discPos.split(",");
    if (pointInPolygon([Number(parts[0]), Number(parts[1])], hull)) return true;
  }
  return false;
}
